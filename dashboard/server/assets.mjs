/**
 * Subida de creativos: imagenes al repo, videos a R2.
 *
 * ## Por que los dos destinos no son el mismo
 *
 * El Worker empaqueta `v1/**` DENTRO de su script, con un tope practico de
 * 700 KB para el bundle entero (`build-bundle.mjs` aborta si se pasa). Una
 * imagen SVG pesa 2 KB y cabe de sobra; un video de pre-roll pesa megas y no
 * cabe — ni debe, porque ademas engordaria el repo de git para siempre.
 *
 * Asi que:
 *
 *  - **Imagenes** → `v1/assets/<juego>/` del repo. Viajan con el commit, se
 *    empaquetan en el Worker y las ven tambien las releases antiguas via
 *    jsDelivr.
 *  - **Videos** → bucket R2. El Worker ya cae a R2 para toda ruta que no
 *    tenga empaquetada, asi que se sirven por la MISMA URL sin tocar codigo.
 *
 * ⚠️ El video NO se commitea, y eso tiene una consecuencia que conviene
 * saber: no existe para las releases que leen jsDelivr. No es una perdida
 * real (el CSP publicado de esas versiones no admite `media-src` externo, o
 * sea que no podian reproducirlo de ninguna manera), pero si alguien busca el
 * fichero en el repo y no lo encuentra, es por esto.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';

import { ASSETS_DIR, SIN_SUPERPROYECTO, findSuperproject } from './paths.mjs';
import { run } from './ops.mjs';

/** Extensiones admitidas y su destino. */
export const TIPOS = {
  '.svg': { kind: 'image', mime: 'image/svg+xml', destino: 'repo' },
  '.png': { kind: 'image', mime: 'image/png', destino: 'repo' },
  '.jpg': { kind: 'image', mime: 'image/jpeg', destino: 'repo' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg', destino: 'repo' },
  '.webp': { kind: 'image', mime: 'image/webp', destino: 'repo' },
  '.mp4': { kind: 'video', mime: 'video/mp4', destino: 'r2' },
  '.webm': { kind: 'video', mime: 'video/webm', destino: 'r2' },
};

/**
 * Tope por imagen. No es el limite duro del Worker (que es el TOTAL del
 * bundle) sino un aviso temprano: con imagenes de este tamano se llega a los
 * 700 KB en pocas piezas, y descubrirlo al desplegar es tarde.
 */
const MAX_IMAGEN_BYTES = 200 * 1024;

/** Tope por video: R2 aguanta mucho mas, pero un pre-roll no debe pesar asi. */
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/**
 * Nombre del bucket de R2, LEIDO de `wrangler.toml` en cada uso.
 *
 * ⚠️ No se fija aqui a proposito. El binding de R2 del Worker lo puede
 * cablear cualquiera (de hecho se cableo en paralelo a este dashboard), y si
 * el nombre viviera en dos sitios acabarian discrepando: el sintoma seria una
 * subida que responde OK contra un bucket que el Worker no lee, o sea un
 * video que existe y no se sirve — y nada en la UI lo delataria.
 *
 * `wrangler.toml` es la fuente: es lo que el Worker usa de verdad.
 *
 * Devuelve `null` si el binding no esta cableado (o esta comentado), que es
 * un estado legitimo: sin el, el dashboard admite imagenes y rechaza videos
 * diciendo exactamente que falta.
 */
export function resolveR2Bucket() {
  const superproyecto = findSuperproject();
  if (!superproyecto) return null;
  let toml;
  try {
    toml = readFileSync(
      join(superproyecto, 'services', 'remote-config', 'wrangler.toml'),
      'utf8',
    );
  } catch {
    return null;
  }
  // Solo lineas ACTIVAS: el fichero trae el bloque comentado como plantilla,
  // y confundirlo con uno cableado haria fallar la subida en wrangler con un
  // error mucho menos claro que el nuestro.
  const activas = toml
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  if (!/\[\[r2_buckets\]\]/.test(activas)) return null;
  const name = activas.match(/bucket_name\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
  if (!name) return null;
  // ⚠️ La jurisdiccion es parte de la IDENTIDAD del bucket: sin ella,
  // `wrangler` apunta a OTRO bucket (uno vacio de la jurisdiccion por
  // defecto) y la subida "funciona" contra un sitio que el Worker no lee.
  const jurisdiction = activas
    .match(/jurisdiction\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
  return { name, jurisdiction };
}

/** Explicacion para cuando se intenta subir video sin R2 cableado. */
export const SIN_R2 = [
  'El bucket de R2 no esta cableado todavia.',
  '',
  'Las imagenes se empaquetan dentro del Worker, pero un video no cabe ahi',
  '(el bundle entero tiene un tope de 700 KB), asi que necesita R2.',
  '',
  'Para cablearlo:',
  '  1. pnpm exec wrangler r2 bucket create <nombre>',
  '  2. descomenta el bloque [[r2_buckets]] de',
  '     services/remote-config/wrangler.toml',
  '  3. pnpm publish:remote-config',
].join('\n');

/**
 * Sanea el nombre del fichero.
 *
 * Solo `[a-z0-9-_.]`: el nombre acaba siendo parte de una URL publica y de
 * una ruta de disco, asi que nada de espacios, acentos ni separadores.
 */
export function safeName(nombre) {
  const ext = extname(nombre).toLowerCase();
  const base = nombre.slice(0, nombre.length - ext.length)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'asset'}${ext}`;
}

/** Ruta publica (la que va escrita en el JSON) de un asset. */
export function publicPath(gameId, nombre) {
  return `/v1/assets/${gameId}/${nombre}`;
}

/**
 * Guarda un asset y devuelve la URL ABSOLUTA que hay que escribir en el JSON.
 *
 * ⚠️ La URL absoluta se construye con `REMOTE_CONFIG_URL`, el mismo host que
 * inyecta el CSP. Escribir aqui otro host dejaria la imagen bloqueada por el
 * navegador **sin ningun error visible**: el anuncio saldria en blanco y
 * pareceria un fallo del modulo de ads.
 */
export async function saveAsset({ gameId, filename, buffer, baseUrl }) {
  const nombre = safeName(filename);
  const ext = extname(nombre).toLowerCase();
  const tipo = TIPOS[ext];

  if (!tipo) {
    return {
      ok: false,
      error: `Extension no admitida: ${ext || '(ninguna)'}.`
        + ` Admitidas: ${Object.keys(TIPOS).join(', ')}`,
    };
  }

  const limite = tipo.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGEN_BYTES;
  if (buffer.length > limite) {
    return {
      ok: false,
      error: `${nombre} pesa ${Math.round(buffer.length / 1024)} KB y el tope`
        + ` para ${tipo.kind === 'video' ? 'video' : 'imagen'} es`
        + ` ${Math.round(limite / 1024)} KB.`
        + (tipo.kind === 'image'
          ? ' El Worker empaqueta las imagenes y el bundle entero tiene 700 KB.'
          : ''),
    };
  }

  const rutaPublica = publicPath(gameId, nombre);
  const url = `${(baseUrl ?? '').replace(/\/+$/, '')}${rutaPublica}`;

  if (tipo.destino === 'repo') {
    const dir = join(ASSETS_DIR, gameId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, nombre), buffer);
    return {
      ok: true,
      url,
      kind: tipo.kind,
      destino: 'repo',
      bytes: buffer.length,
      sha: createHash('sha256').update(buffer).digest('hex').slice(0, 12),
      nota: 'Guardado en el repo. Publica para que quede vivo.',
    };
  }

  // Video → R2. Se sube con `wrangler`, que ya esta autenticado en el
  // superproyecto; asi no hace falta gestionar credenciales aqui.
  const superproyecto = findSuperproject();
  if (!superproyecto) {
    return { ok: false, error: SIN_SUPERPROYECTO };
  }

  const bucket = resolveR2Bucket();
  if (!bucket) {
    return { ok: false, error: SIN_R2 };
  }

  const tmp = join(
    process.env.TMPDIR || '/tmp',
    `dashboard-upload-${Date.now()}-${nombre}`,
  );
  writeFileSync(tmp, buffer);

  // La clave en R2 es la ruta publica SIN la barra inicial: es exactamente
  // lo que busca el fallback del Worker (`bucket.get(path.slice(1))`).
  const clave = rutaPublica.slice(1);
  const subida = await run(
    'pnpm',
    [
      'exec', 'wrangler', 'r2', 'object', 'put', `${bucket.name}/${clave}`,
      '--file', tmp,
      '--content-type', tipo.mime,
      '--remote',
      ...(bucket.jurisdiction ? ['--jurisdiction', bucket.jurisdiction] : []),
    ],
    join(superproyecto, 'services', 'remote-config'),
  );

  if (subida.code !== 0) {
    return {
      ok: false,
      error: `No se pudo subir a R2:\n\n${subida.output}`,
    };
  }

  return {
    ok: true,
    url,
    kind: tipo.kind,
    destino: 'r2',
    bytes: buffer.length,
    sha: createHash('sha256').update(buffer).digest('hex').slice(0, 12),
    nota: `Subido a R2 (${bucket.name}): ya se sirve, sin desplegar.`,
    output: subida.output,
  };
}

/** Assets que ya existen en el repo para un juego. */
export function listAssets(gameId, baseUrl) {
  const dir = join(ASSETS_DIR, gameId);
  let entradas = [];
  try {
    entradas = readdirSync(dir);
  } catch {
    return [];   // el juego aun no tiene assets propios
  }
  return entradas
    .filter((f) => TIPOS[extname(f).toLowerCase()])
    .sort()
    .map((f) => ({
      name: f,
      url: `${(baseUrl ?? '').replace(/\/+$/, '')}${publicPath(gameId, f)}`,
      bytes: statSync(join(dir, f)).size,
      kind: TIPOS[extname(f).toLowerCase()].kind,
    }));
}
