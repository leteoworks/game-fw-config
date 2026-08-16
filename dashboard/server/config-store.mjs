/**
 * Lectura y escritura de los JSON de configuracion, con validacion.
 *
 * Toda escritura pasa por `saveChannel`, que valida ANTES de tocar el disco.
 * Es deliberado: el CI del repo rechaza un JSON invalido al publicar, asi que
 * dejar guardar algo invalido solo aplaza el error hasta un sitio donde
 * cuesta mas entenderlo (un workflow en rojo, no un aviso en el formulario).
 */

import Ajv from 'ajv/dist/2020.js';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SCHEMAS_DIR, V1_DIR } from './paths.mjs';

/** Carpetas de `v1/` que NO son juegos. */
const NO_SON_JUEGOS = new Set(['assets']);

/** Juegos con configuracion publicada, con sus canales. */
export function listGames() {
  const juegos = [];
  for (const nombre of readdirSync(V1_DIR).sort()) {
    if (NO_SON_JUEGOS.has(nombre)) continue;
    const dir = join(V1_DIR, nombre);
    if (!statSync(dir).isDirectory()) continue;
    const canales = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    if (canales.length === 0) continue;
    juegos.push({
      id: nombre,
      channels: canales,
      hasSchema: hasSchema(nombre),
    });
  }
  return juegos;
}

function schemaPath(gameId) {
  return join(SCHEMAS_DIR, `${gameId}.schema.json`);
}

export function hasSchema(gameId) {
  try {
    statSync(schemaPath(gameId));
    return true;
  } catch {
    return false;
  }
}

export function readSchema(gameId) {
  return JSON.parse(readFileSync(schemaPath(gameId), 'utf8'));
}

/**
 * Etiquetas y explicaciones EN ESPANOL del formulario.
 *
 * Viven aparte del schema a proposito: el schema es el CONTRATO (lo que
 * valida el CI) y esto es documentacion de producto. Mezclarlos haria que
 * cada retoque de una frase tocara el fichero que valida las publicaciones.
 *
 * Ausente = el formulario funciona igual, con las claves humanizadas y las
 * descripciones secas del contrato. Es degradacion, no fallo: un juego nuevo
 * puede tener schema y todavia no tener textos.
 */
export function readUi(gameId) {
  try {
    return JSON.parse(readFileSync(
      join(SCHEMAS_DIR, `${gameId}.ui.json`), 'utf8',
    ));
  } catch {
    return null;
  }
}

function channelPath(gameId, channel) {
  return join(V1_DIR, gameId, `${channel}.json`);
}

export function readChannel(gameId, channel) {
  return JSON.parse(readFileSync(channelPath(gameId, channel), 'utf8'));
}

/** Todos los canales del juego MENOS el pedido (para marcar diferencias). */
export function readOtherChannels(gameId, channel) {
  const juego = listGames().find((g) => g.id === gameId);
  const otros = {};
  for (const otro of juego?.channels ?? []) {
    if (otro === channel) continue;
    otros[otro] = readChannel(gameId, otro);
  }
  return otros;
}

/**
 * Validadores ya compilados, por juego.
 *
 * ⚠️ NO es una optimizacion: es obligatorio. Ajv indexa los schemas por su
 * `$id`, asi que compilar DOS VECES el mismo lanza «schema with key or id …
 * already exists». Sin esta cache, el primer guardado de la sesion
 * funcionaba y **todos los siguientes fallaban** con un error de Ajv que no
 * se parece en nada a su causa — y encima el sintoma («no se ha escrito
 * nada») era indistinguible de un JSON que no valida.
 *
 * La clave incluye el CONTENIDO del schema para que, si se edita el schema
 * con el dashboard abierto, la siguiente validacion use el nuevo y no una
 * copia vieja.
 */
const validadores = new Map();

function compiledValidator(gameId) {
  const bruto = readFileSync(schemaPath(gameId), 'utf8');
  const cacheado = validadores.get(gameId);
  if (cacheado && cacheado.bruto === bruto) return cacheado.validar;

  // `strict: false` como en `scripts/validate.mjs`: el schema declara
  // `$schema` de draft 2020-12 y lleva anotaciones propias que Ajv no conoce;
  // en modo estricto las rechazaria y no validaria nada.
  const instancia = new Ajv({ allErrors: true, strict: false });
  const validar = instancia.compile(JSON.parse(bruto));
  validadores.set(gameId, { bruto, validar });
  return validar;
}

/** Valida unos datos contra el schema del juego. */
export function validate(gameId, data) {
  if (!hasSchema(gameId)) {
    return { ok: true, errors: [], sinSchema: true };
  }
  const validar = compiledValidator(gameId);
  const ok = validar(data);
  return {
    ok,
    sinSchema: false,
    errors: (validar.errors ?? []).map((e) => ({
      // `instancePath` viene como '/ads/banners/0/ttlMs'; la UI necesita la
      // ruta con puntos para poder resaltar el campo culpable.
      path: e.instancePath.replace(/^\//, '').replaceAll('/', '.'),
      message: e.message,
      params: e.params,
    })),
  };
}

/**
 * Guarda un canal en disco. Devuelve `{ ok, errors }` sin escribir si no
 * valida.
 *
 * ⚠️ Se escribe con `JSON.stringify(…, 2)` + salto final, el MISMO formato
 * que usan los scripts del repo. Si el dashboard formateara distinto, cada
 * guardado produciria un diff gigante de reformateo que enterraria el cambio
 * real en la revision.
 */
export function saveChannel(gameId, channel, data) {
  const resultado = validate(gameId, data);
  if (!resultado.ok) return resultado;

  writeFileSync(
    channelPath(gameId, channel),
    `${JSON.stringify(data, null, 2)}\n`,
    'utf8',
  );
  return resultado;
}
