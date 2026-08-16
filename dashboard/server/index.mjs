/**
 * Servidor del dashboard de remote-config. SOLO LOCAL.
 *
 * Un unico proceso y un unico puerto: la API va bajo `/api/**` y todo lo
 * demas lo sirve Vite en modo middleware. Dos puertos con proxy funcionan
 * igual, pero obligan a arrancar dos cosas y a que la UI sepa donde vive la
 * API — de mas partes moviles para una herramienta de mantenimiento.
 *
 * ## Esto NO se expone a la red, y no por descuido
 *
 * El servidor escribe ficheros, ejecuta `git push`, despliega un Worker y
 * sube a R2. Sin autenticacion de ninguna clase, porque la unica frontera es
 * que solo escucha en `127.0.0.1`. Cualquiera que llegue al puerto puede
 * publicar en produccion.
 *
 * ❌ NO cambiar el bind a `0.0.0.0` "para probarlo desde el movil". Si algun
 * dia hace falta acceso remoto, lo que hay que anadir es autenticacion, no
 * abrir el bind.
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  listGames, readChannel, readOtherChannels, readSchema, readUi, saveChannel,
  validate,
} from './config-store.mjs';
import { listAssets, saveAsset } from './assets.mjs';
import { deployOnly, publish, purge, status } from './ops.mjs';
import { CONFIG_ROOT, findSuperproject } from './paths.mjs';

const HOST = '127.0.0.1';
const PUERTO = Number(process.env.DASHBOARD_PORT ?? 7788);

/** Tope del cuerpo: una subida de video legitima cabe, un DoS accidental no. */
const MAX_BODY = 25 * 1024 * 1024;

/**
 * URL publica del remote-config, para construir las URLs de los assets.
 *
 * Se lee del `.env` del superproyecto para que haya UNA sola fuente: si el
 * dashboard tuviera su propia copia del host y se desincronizara del CSP, las
 * imagenes se bloquearian en el juego sin ningun error visible.
 */
async function resolveBaseUrl() {
  const superproyecto = findSuperproject();
  if (!superproyecto) return '';
  try {
    const env = await readFile(join(superproyecto, '.env'), 'utf8');
    return env.match(/^REMOTE_CONFIG_URL=(.*)$/m)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

function json(res, code, payload) {
  const cuerpo = JSON.stringify(payload);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (t) => {
      total += t.length;
      if (total > MAX_BODY) {
        reject(new Error(`Cuerpo mayor de ${MAX_BODY / 1024 / 1024} MB`));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

/**
 * Valida el id de juego contra los que EXISTEN.
 *
 * El id viaja hasta un `join` de rutas, asi que comprobarlo contra la lista
 * real (y no con un regex) cierra de raiz cualquier `../` — no hay forma de
 * componer una ruta que no sea la de un juego declarado.
 */
function gameIdValido(gameId) {
  return listGames().some((g) => g.id === gameId);
}

async function manejarApi(req, res, url) {
  const partes = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [recurso, ...resto] = partes;

  // ── GET /api/bootstrap ──────────────────────────────────────────────
  if (recurso === 'bootstrap' && req.method === 'GET') {
    return json(res, 200, {
      games: listGames(),
      status: await status(),
      baseUrl: await resolveBaseUrl(),
      configRoot: CONFIG_ROOT,
    });
  }

  // ── GET /api/config/<juego>/<canal> ─────────────────────────────────
  if (recurso === 'config' && req.method === 'GET') {
    const [gameId, channel] = resto;
    if (!gameIdValido(gameId)) return json(res, 404, { error: 'juego desconocido' });
    try {
      return json(res, 200, {
        data: readChannel(gameId, channel),
        schema: readSchema(gameId),
        ui: readUi(gameId),
        otherChannels: readOtherChannels(gameId, channel),
        assets: listAssets(gameId, await resolveBaseUrl()),
      });
    } catch (err) {
      return json(res, 404, { error: String(err.message ?? err) });
    }
  }

  // ── PUT /api/config/<juego>/<canal> ─────────────────────────────────
  if (recurso === 'config' && req.method === 'PUT') {
    const [gameId, channel] = resto;
    if (!gameIdValido(gameId)) return json(res, 404, { error: 'juego desconocido' });
    const cuerpo = JSON.parse((await leerCuerpo(req)).toString('utf8'));
    const resultado = saveChannel(gameId, channel, cuerpo.data);
    return json(res, resultado.ok ? 200 : 422, resultado);
  }

  // ── POST /api/validate/<juego> (sin escribir) ───────────────────────
  if (recurso === 'validate' && req.method === 'POST') {
    const [gameId] = resto;
    if (!gameIdValido(gameId)) return json(res, 404, { error: 'juego desconocido' });
    const cuerpo = JSON.parse((await leerCuerpo(req)).toString('utf8'));
    return json(res, 200, validate(gameId, cuerpo.data));
  }

  // ── POST /api/publish | /api/purge/<juego> | /api/deploy ────────────
  if (recurso === 'publish' && req.method === 'POST') {
    const cuerpo = JSON.parse((await leerCuerpo(req)).toString('utf8') || '{}');
    return json(res, 200, await publish({ message: cuerpo.message }));
  }
  if (recurso === 'deploy' && req.method === 'POST') {
    return json(res, 200, await deployOnly());
  }
  if (recurso === 'purge' && req.method === 'POST') {
    const [gameId] = resto;
    if (gameId && !gameIdValido(gameId)) {
      return json(res, 404, { error: 'juego desconocido' });
    }
    return json(res, 200, await purge({ gameId }));
  }

  // ── POST /api/assets/<juego> ────────────────────────────────────────
  if (recurso === 'assets' && req.method === 'POST') {
    const [gameId] = resto;
    if (!gameIdValido(gameId)) return json(res, 404, { error: 'juego desconocido' });
    const filename = decodeURIComponent(req.headers['x-filename'] ?? '');
    if (!filename) return json(res, 400, { error: 'falta la cabecera x-filename' });
    const buffer = await leerCuerpo(req);
    const resultado = await saveAsset({
      gameId, filename, buffer, baseUrl: await resolveBaseUrl(),
    });
    return json(res, resultado.ok ? 200 : 422, resultado);
  }

  // ── GET /api/status ─────────────────────────────────────────────────
  if (recurso === 'status' && req.method === 'GET') {
    return json(res, 200, await status());
  }

  return json(res, 404, { error: `ruta desconocida: ${url.pathname}` });
}

async function main() {
  // Vite en modo middleware: la UI se sirve por el mismo puerto que la API,
  // con HMR incluido. Se importa aqui (y no arriba) para que el servidor
  // pueda arrancar aunque solo se quiera la API.
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    root: join(CONFIG_ROOT, 'dashboard'),
    server: { middlewareMode: true },
    appType: 'spa',
  });

  const servidor = createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PUERTO}`);
    if (url.pathname.startsWith('/api/')) {
      manejarApi(req, res, url).catch((err) => {
        // El error va entero a la UI: en una herramienta local, el stack es
        // informacion util, no una fuga.
        json(res, 500, { error: String(err?.stack ?? err) });
      });
      return;
    }
    vite.middlewares(req, res);
  });

  servidor.listen(PUERTO, HOST, () => {
    const superproyecto = findSuperproject();
    console.log(`\n  Dashboard de remote-config`);
    console.log(`  → http://${HOST}:${PUERTO}\n`);
    console.log(`  config:        ${CONFIG_ROOT}`);
    console.log(`  superproyecto: ${superproyecto ?? '(no encontrado)'}`);
    if (!superproyecto) {
      console.log('  ⚠️  sin superproyecto: se puede guardar y hacer push,');
      console.log('      pero NO desplegar el Worker ni purgar.');
    }
    console.log('');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
