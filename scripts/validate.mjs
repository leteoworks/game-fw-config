// Valida cada JSON de configs/v1/<game>/<channel>.json
// contra el schema de schemas/<game>.schema.json.
// Ejecutado en CI antes de publicar.

// Usamos el build de Ajv para draft 2020-12 (el
// schema lo declara en `$schema`). El default de
// `ajv` expone draft 7 y rechazaria el $schema.
import Ajv from 'ajv/dist/2020.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Hosts desde los que la APP puede cargar una creatividad de
 * publicidad.
 *
 * Tiene que coincidir con lo que el CSP del juego admite en `img-src`
 * y `media-src` (hoy: el propio Worker de remote-config, inyectado
 * desde `REMOTE_CONFIG_CSP_HOST`). Existe porque el fallo es MUDO: si
 * una campaña apunta a otro dominio, el navegador bloquea la imagen,
 * el modulo no monta nada —ni overlay, ni impresion, ni error— y el
 * resultado es indistinguible de "no hay campaña". Se descubre a mano,
 * mirando por que un anuncio publicado no sale.
 *
 * Es una lista ANTI-SHRINK: abrir un host nuevo aqui NO basta, hay que
 * abrirlo tambien en el CSP del juego (`index.html` +
 * `scripts/lib/csp-hosts.mjs` del superproyecto), y eso exige RELEASE.
 * Ampliable por entorno para no bloquear una prueba:
 * `ADS_ALLOWED_ASSET_HOSTS=https://uno,https://dos`.
 */
const ALLOWED_ASSET_ORIGINS = [
  'https://gamefw-remote-config.acamposruiz.workers.dev',
  ...(process.env.ADS_ALLOWED_ASSET_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0),
];

/** Todas las URLs de asset de un subarbol `ads`, con su ruta. */
function adsAssetUrls(ads) {
  const out = [];
  const banners = Array.isArray(ads?.banners) ? ads.banners : [];
  banners.forEach((banner, i) => {
    const push = (list, where) => {
      if (!Array.isArray(list)) return;
      list.forEach((item, j) => {
        if (typeof item?.url === 'string') {
          out.push({ url: item.url, at: `banners[${i}].${where}[${j}]` });
        }
      });
    };
    push(banner?.images, 'images');
    push(banner?.miniBanner?.images, 'miniBanner.images');
    push(banner?.preRollVideo?.sources, 'preRollVideo.sources');
  });
  return out;
}

/**
 * ¿Esta URL la puede cargar el juego? Se admiten `data:` (el CSP las
 * permite en imagen) y las rutas relativas del propio bundle; lo
 * demas tiene que caer en un origen autorizado.
 */
function assetUrlAllowed(url) {
  if (url.startsWith('data:') || url.startsWith('/')) return true;
  try {
    return ALLOWED_ASSET_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Tramos del parque (`rollout.cohort.audience`) vacios o invertidos.
 *
 * El contrato pide `desde < hasta`, pero esa regla no cabe en JSON Schema
 * (solo `0-100` por campo), asi que el ajv de arriba la deja pasar. El
 * juego la coacciona a "nadie" (fail-closed): la campaña no se enseña y
 * nada avisa. Mejor pararlo aqui, antes de publicar. Se busca en todo el
 * documento: el sobre es comun a todas las secciones.
 */
function tramosVacios(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => tramosVacios(item, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (
      key === 'audience'
      && value !== null
      && typeof value === 'object'
      && typeof value.from === 'number'
      && typeof value.to === 'number'
      && value.from >= value.to
    ) {
      out.push({ at, from: value.from, to: value.to });
    }
    out.push(...tramosVacios(value, at));
  }
  return out;
}

/**
 * Experimentos (`rollout.experiment`) que el schema no puede rechazar: dos
 * variantes con el mismo nombre (el reparto se rompe y la telemetria no
 * distingue) y pesos todos a 0 (todo el mundo en la primera; se admite pero
 * se avisa en la auditoria, no aqui).
 */
function experimentosRotos(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => experimentosRotos(item, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (
      key === 'experiment'
      && value !== null
      && typeof value === 'object'
      && Array.isArray(value.variants)
    ) {
      const nombres = value.variants
        .map((v) => (v && typeof v.name === 'string' ? v.name : null))
        .filter((n) => n !== null);
      const repetidos = [...new Set(nombres.filter((n, i) => nombres.indexOf(n) !== i))];
      if (repetidos.length > 0) {
        out.push({
          at,
          motivo: `variantes repetidas (${repetidos.join(', ')}): el reparto `
            + 'del experimento se rompe. Dale un nombre distinto a cada una.',
        });
      }
    }
    out.push(...experimentosRotos(value, at));
  }
  return out;
}

const schemasDir = 'schemas';
const configsDir = 'v1';

let failed = false;

for (const schemaFile of readdirSync(schemasDir)) {
  if (!schemaFile.endsWith('.schema.json')) continue;
  const gameId = schemaFile.replace('.schema.json', '');
  const schema = JSON.parse(
    readFileSync(join(schemasDir, schemaFile), 'utf8'),
  );
  const validate = ajv.compile(schema);

  const gameDir = join(configsDir, gameId);
  try {
    statSync(gameDir);
  } catch {
    console.warn(
      `SKIP ${gameId}: no hay carpeta ${gameDir}`,
    );
    continue;
  }

  for (const configFile of readdirSync(gameDir)) {
    if (!configFile.endsWith('.json')) continue;
    const fullPath = join(gameDir, configFile);
    const data = JSON.parse(
      readFileSync(fullPath, 'utf8'),
    );
    if (!validate(data)) {
      failed = true;
      console.error(
        `FAIL ${gameId}/${configFile}:`,
        JSON.stringify(validate.errors, null, 2),
      );
    } else {
      console.log(`OK   ${gameId}/${configFile}`);
    }

    for (const problema of experimentosRotos(data)) {
      failed = true;
      console.error(
        `FAIL ${gameId}/${configFile}: ${problema.at}: ${problema.motivo}`,
      );
    }

    for (const tramo of tramosVacios(data)) {
      failed = true;
      console.error(
        `FAIL ${gameId}/${configFile}: tramo vacio o invertido en `
        + `${tramo.at} (${tramo.from} → ${tramo.to})\n`
        + '  El juego lo trata como "nadie": la campaña no se enseñaria a '
        + 'ningun jugador\n  sin que nada avise. → pon desde < hasta, o '
        + 'apaga la campaña (rollout.enabled: false).',
      );
    }

    // Guard de ids repetidos: el schema no puede verlo (cada campaña
    // es valida por separado). Y el cliente persiste el cooldown y el
    // cierre por sesion POR id, asi que dos campañas con el mismo id
    // se heredan las marcas la una a la otra: la segunda puede no
    // llegar a verse nunca sin que nada falle. Pasa con solo duplicar
    // una campaña en el formulario y olvidar renombrarla.
    const vistos = new Set();
    for (const banner of (data.ads?.banners ?? [])) {
      const id = banner?.id;
      if (typeof id !== 'string') continue;
      if (vistos.has(id)) {
        failed = true;
        console.error(
          `FAIL ${gameId}/${configFile}: dos campañas con el mismo id `
          + `«${id}»\n`
          + '  El cooldown y el cierre por sesion se guardan por id: la '
          + 'segunda heredaria\n  las marcas de la primera y podria no '
          + 'mostrarse nunca.\n  → dale un id propio a cada campaña.',
        );
      }
      vistos.add(id);
    }

    // Guard de creatividades: el schema no puede comprobarlo (una URL
    // de otro dominio es un string perfectamente valido).
    for (const { url, at } of adsAssetUrls(data.ads)) {
      if (assetUrlAllowed(url)) continue;
      failed = true;
      console.error(
        `FAIL ${gameId}/${configFile}: creatividad en un host que el `
        + `juego NO puede cargar\n`
        + `  ${at} → ${url}\n`
        + '  El CSP la bloquearia y el anuncio no se montaria, SIN '
        + 'ningun error visible.\n'
        + '  → sirvela desde '
        + `${ALLOWED_ASSET_ORIGINS[0]}/v1/assets/...`,
      );
    }
  }
}

if (failed) {
  console.error('\nValidation failed.');
  process.exit(1);
}

console.log('\nAll configs valid.');
