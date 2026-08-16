/**
 * Operaciones de consola: git, despliegue del Worker y purga de jsDelivr.
 *
 * Todas devuelven `{ steps: [{ cmd, code, output }], ok }` con la salida
 * CRUDA, que es lo que se pinta en el dashboard. Nada de resumir: cuando un
 * push falla, lo util es el mensaje de git tal cual (`rejected`,
 * `non-fast-forward`, el nombre de la rama), no un «ha fallado» nuestro.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONFIG_ROOT, SIN_SUPERPROYECTO, findSuperproject } from './paths.mjs';

/**
 * Variables de entorno del superproyecto, para los comandos que las necesitan.
 *
 * ⚠️ `wrangler` NO lee `.env.local` por su cuenta — es la trampa que el
 * proyecto ya tiene documentada y que obliga a un `set -a; . ./.env.local`
 * antes de cualquier comando suyo. Desde un servidor eso no existe, asi que
 * el fallo aparecia como `Failed to fetch auth token: 400` al subir un video:
 * un mensaje sobre credenciales que no dice que lo que falta es cargar un
 * fichero.
 *
 * Se cargan `.env` y luego `.env.local` (que pisa al primero), replicando la
 * precedencia del resto del repo. Lo que ya venga en el entorno real MANDA:
 * si alguien arranca el dashboard con la variable puesta a mano, gana la suya.
 */
function envDelSuperproyecto() {
  const superproyecto = findSuperproject();
  if (!superproyecto) return {};

  const acumulado = {};
  for (const fichero of ['.env', '.env.local']) {
    let texto;
    try {
      texto = readFileSync(join(superproyecto, fichero), 'utf8');
    } catch {
      continue;   // que falte `.env.local` es normal en un clon limpio
    }
    for (const linea of texto.split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, '');
      if (valor !== '') acumulado[m[1]] = valor;
    }
  }
  return acumulado;
}

/** Tope por operacion: un comando colgado no puede dejar la UI esperando. */
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ejecuta un comando capturando stdout y stderr MEZCLADOS en orden.
 *
 * Van mezclados a proposito: git escribe el progreso por stderr y el
 * resultado por stdout, asi que separarlos rompe la narrativa de lo que paso.
 */
export function run(cmd, args, cwd, { env } = {}) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const hijo = spawn(cmd, args, {
      cwd,
      // El entorno del superproyecto va DEBAJO del real: lo que ya este
      // definido en el proceso manda sobre lo leido de los ficheros.
      env: { ...envDelSuperproyecto(), ...process.env, ...env },
      // Sin shell: los argumentos van como array, asi que nada de lo que
      // venga del formulario puede interpretarse como comando.
      shell: false,
    });

    let salida = '';
    const acumular = (buf) => { salida += buf.toString(); };
    hijo.stdout.on('data', acumular);
    hijo.stderr.on('data', acumular);

    const temporizador = setTimeout(() => {
      hijo.kill('SIGKILL');
      salida += `\n[dashboard] abortado tras ${TIMEOUT_MS / 1000}s\n`;
    }, TIMEOUT_MS);

    hijo.on('error', (err) => {
      clearTimeout(temporizador);
      resolve({
        cmd: `${cmd} ${args.join(' ')}`,
        code: -1,
        output: `${salida}\n[dashboard] no se pudo ejecutar: ${err.message}`,
        ms: Date.now() - inicio,
      });
    });

    hijo.on('close', (code) => {
      clearTimeout(temporizador);
      resolve({
        cmd: `${cmd} ${args.join(' ')}`,
        code: code ?? -1,
        output: salida,
        ms: Date.now() - inicio,
      });
    });
  });
}

/** Encadena pasos, PARANDO en el primero que falle. */
async function secuencia(pasos) {
  const hechos = [];
  for (const paso of pasos) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await paso();
    if (resultado === null) continue;      // paso omitido
    hechos.push(resultado);
    if (resultado.code !== 0) {
      return { ok: false, steps: hechos };
    }
  }
  return { ok: true, steps: hechos };
}

/** Estado del repo de config: rama, limpieza y commits pendientes. */
export async function status() {
  const [rama, sucio, pendientes] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], CONFIG_ROOT),
    run('git', ['status', '--porcelain'], CONFIG_ROOT),
    run('git', ['log', '--oneline', '@{u}..HEAD'], CONFIG_ROOT),
  ]);
  return {
    branch: rama.output.trim(),
    dirty: sucio.output.trim().length > 0,
    dirtyFiles: sucio.output.trim().split('\n').filter(Boolean),
    unpushed: pendientes.output.trim().split('\n').filter(Boolean),
    superproject: findSuperproject(),
  };
}

/**
 * PUBLICAR: commit (si hay cambios) → pull --rebase → push → desplegar.
 *
 * ⚠️ El despliegue del Worker NO es opcional. Desde ADR-038, un `git push` a
 * secas deja el cambio en GitHub pero **no vivo** para las builds actuales:
 * quien lo diera por publicado se quedaria esperando un efecto que no llega.
 * Por eso van en la misma accion y, si falta el superproyecto para desplegar,
 * la operacion termina en ROJO avisando — no en verde a medias.
 */
export async function publish({ message }) {
  const superproyecto = findSuperproject();
  const mensaje = (message ?? '').trim()
    || 'chore(config): cambios desde el dashboard';

  const resultado = await secuencia([
    async () => {
      const estado = await run('git', ['status', '--porcelain'], CONFIG_ROOT);
      if (estado.output.trim() === '') {
        return {
          cmd: 'git status',
          code: 0,
          output: 'Sin cambios locales que commitear.\n',
          ms: estado.ms,
        };
      }
      const add = await run('git', ['add', '-A'], CONFIG_ROOT);
      if (add.code !== 0) return add;
      return run('git', ['commit', '-m', mensaje], CONFIG_ROOT);
    },
    () => run('git', ['pull', '--rebase', 'origin', 'main'], CONFIG_ROOT),
    () => run('git', ['push', 'origin', 'main'], CONFIG_ROOT),
  ]);

  if (!resultado.ok) return resultado;

  if (!superproyecto) {
    return {
      ok: false,
      steps: [...resultado.steps, {
        cmd: 'desplegar Worker',
        code: 1,
        output: SIN_SUPERPROYECTO,
        ms: 0,
      }],
    };
  }

  // `publish:remote-config` del superproyecto: empaqueta, despliega y
  // verifica byte a byte contra la URL viva. Se reusa en vez de repetir esos
  // tres pasos aqui, para que no haya dos definiciones de "publicar".
  const despliegue = await run(
    'pnpm', ['publish:remote-config'], superproyecto,
  );
  return {
    ok: despliegue.code === 0,
    steps: [...resultado.steps, despliegue],
  };
}

/**
 * PURGAR la cache de jsDelivr.
 *
 * ⚠️ Esto NO afecta a las builds actuales (que leen el Worker): sirve solo
 * para las releases publicadas ANTES de ADR-038, que llevan la URL de
 * jsDelivr compilada dentro del bundle. Y ahi el retardo del alias `@main`
 * (hasta 12 h) no se puede evitar ni con la purga.
 */
export async function purge({ gameId }) {
  const superproyecto = findSuperproject();
  if (!superproyecto) {
    return {
      ok: false,
      steps: [{
        cmd: 'purgar',
        code: 1,
        output: SIN_SUPERPROYECTO,
        ms: 0,
      }],
    };
  }
  const args = ['purge:remote-config'];
  if (gameId) args.push(gameId);
  const resultado = await run('pnpm', args, superproyecto);
  return { ok: resultado.code === 0, steps: [resultado] };
}

/** Solo desplegar (sin tocar git): util tras un guardado local. */
export async function deployOnly() {
  const superproyecto = findSuperproject();
  if (!superproyecto) {
    return {
      ok: false,
      steps: [{ cmd: 'desplegar', code: 1, output: SIN_SUPERPROYECTO, ms: 0 }],
    };
  }
  const resultado = await run(
    'pnpm', ['publish:remote-config', '--allow-dirty'], superproyecto,
  );
  return { ok: resultado.code === 0, steps: [resultado] };
}
