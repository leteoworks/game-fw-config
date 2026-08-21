/**
 * Tests del traductor schema → formulario (runner de Node, sin deps).
 *
 *   node --test dashboard/src/lib/
 *
 * Lo que se defiende, por orden de importancia:
 *
 *  1. **Que abrir y guardar sin tocar nada no cambie el fichero.** Es el
 *     riesgo real del dashboard: materializar defaults congelaria el
 *     comportamiento del juego sin que nadie lo pidiera.
 *  2. **Que los tipos con `null` se editen bien.** `ttlMs: null` y `ttlMs: 0`
 *     significan cosas OPUESTAS (no mostrar nunca / mostrar para siempre).
 *  3. **Que el control elegido sea el idoneo**, incluido el orden de
 *     precedencia entre las senales.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  blankItem,
  buildFormModel,
  buildItemSubtree,
  deletePath,
  humanizeKey,
  normalizeType,
  readPath,
  resolveWidget,
  WIDGETS,
  writePath,
  flattenSchema,
} from './schema-form.mjs';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const schemaReal = JSON.parse(readFileSync(
  join(RAIZ, 'schemas', 'snake-classic.schema.json'), 'utf8',
));

// ─── Eleccion de control ──────────────────────────────────────────────

test('boolean → interruptor', () => {
  assert.equal(resolveWidget('enabled', { type: 'boolean' }), 'toggle');
});

test('enum corto → radio; enum largo → desplegable', () => {
  assert.equal(
    resolveWidget('orientation', { enum: ['portrait', 'landscape'] }),
    'radio',
  );
  assert.equal(
    resolveWidget('x', { enum: ['a', 'b', 'c', 'd'] }),
    'select',
  );
});

test('el enum manda sobre el tipo', () => {
  // Un enum es un conjunto CERRADO: ofrecerlo como texto libre dejaria
  // escribir un valor que el validador rechaza al guardar.
  assert.equal(
    resolveWidget('placement', { type: 'string', enum: ['post-splash'] }),
    'radio',
  );
});

test('numero con min Y max → deslizador; sin rango → numero', () => {
  assert.equal(
    resolveWidget('maxAttempts', { type: 'integer', minimum: 0, maximum: 10 }),
    'range',
  );
  assert.equal(resolveWidget('freeEpisodeLimit', { type: 'integer' }), 'number');
});

test('los sufijos de unidad deciden dentro del tipo', () => {
  assert.equal(
    resolveWidget('cohortPercent', { type: 'number', minimum: 0, maximum: 100 }),
    'percent',
  );
  assert.equal(
    resolveWidget('cooldownMs', { type: ['number', 'null'], minimum: 0 }),
    'duration',
  );
  assert.equal(resolveWidget('url', { type: 'string' }), 'url');
  assert.equal(resolveWidget('minVersion', { type: ['string', 'null'] }), 'version');
});

test('⚠️ el nombre NO puede ganarle al tipo', () => {
  // `maxVersion` suena a version, pero si el schema dice que es un numero,
  // un editor de semver escribiria un string y el guardado fallaria.
  assert.equal(resolveWidget('maxVersion', { type: 'number' }), 'number');
  // Y al reves: un `cohortPercent` string no debe salir como porcentaje.
  assert.equal(resolveWidget('cohortPercent', { type: 'string' }), 'text');
});

test('array de strings → etiquetas; array de objetos → tarjetas', () => {
  assert.equal(
    resolveWidget('locales', { type: 'array', items: { type: 'string' } }),
    'string-list',
  );
  assert.equal(
    resolveWidget('banners', {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } } },
    }),
    'object-list',
  );
});

test('objeto abierto de OBJETOS → mapa de objetos', () => {
  // `analytics.providers`: destino → { enabled, batching }. Antes caia a
  // texto y salia literalmente «[object Object]».
  assert.equal(
    resolveWidget('providers', {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
      },
    }),
    'object-map',
  );
});

test('objeto abierto de strings → mapa por idioma', () => {
  assert.equal(
    resolveWidget('label', {
      type: 'object',
      additionalProperties: { type: 'string' },
    }),
    'locale-map',
  );
});

test('x-ui.widget gana a todo lo demas', () => {
  // Es el escape hatch: el schema no puede decir "este string es la URL de
  // una imagen y merece vista previa".
  assert.equal(
    resolveWidget('url', { type: 'string', 'x-ui': { widget: 'asset-image' } }),
    'asset-image',
  );
});

test('x-ui.widget: datetime → selector de fecha y hora', () => {
  // Un instante ISO es un string cualquiera para el schema; la pista es lo
  // que evita que el calendario de una campaña se teclee a mano (y sin
  // zona, que es el error que el juego no puede detectar).
  assert.equal(
    resolveWidget('from', { type: 'string', 'x-ui': { widget: 'datetime' } }),
    'datetime',
  );
  assert.ok(WIDGETS.includes('datetime'), 'datetime tiene que ser un widget conocido');
  // Y la forma «string o null» del schema generado (anyOf) tambien resuelve.
  assert.equal(
    resolveWidget('to', {
      'x-ui': { widget: 'datetime' },
      anyOf: [
        { type: 'string', format: 'date-time', 'x-ui': { widget: 'datetime' } },
        { type: 'null' },
      ],
    }),
    'datetime',
  );
});

test('el sobre del schema real: calendario, rampa y ficha usan datetime', () => {
  const modelo = buildFormModel(schemaReal, { data: {} });
  const ads = modelo.sections.find((s) => s.key === 'ads');
  const banners = ads.children.find((c) => c.key === 'banners');
  const tarjeta = buildItemSubtree({
    itemsSchema: banners.itemsSchema, basePath: 'ads.banners', index: 0, data: {},
  });
  const rollout = tarjeta.children.find((c) => c.key === 'rollout');
  const schedule = rollout.children.find((c) => c.key === 'schedule');
  const desde = schedule.children.find((c) => c.key === 'from');
  assert.equal(desde.widget, 'datetime');
  assert.equal(desde.nullable, true, 'el calendario admite «sin fecha»');

  const cohort = rollout.children.find((c) => c.key === 'cohort');
  const ramp = cohort.children.find((c) => c.key === 'ramp');
  assert.equal(ramp.widget, 'object-list');
  const escalon = buildItemSubtree({
    itemsSchema: ramp.itemsSchema, basePath: 'x', index: 0, data: {},
  });
  assert.equal(escalon.children.find((c) => c.key === 'at').widget, 'datetime');
  assert.equal(escalon.children.find((c) => c.key === 'percent').widget, 'percent');

  const meta = rollout.children.find((c) => c.key === 'meta');
  const updatedAt = meta.children.find((c) => c.key === 'updatedAt');
  assert.equal(updatedAt.widget, 'datetime');
  assert.equal(updatedAt.nullable, false);
});

test('los segmentos llegan al modelo con su titulo y explicacion', () => {
  // `x-segments` viaja en el schema generado; el control lo pinta bajo cada
  // casilla. Sin esto, «veterans» es solo una palabra.
  const modelo = buildFormModel(schemaReal, { data: {} });
  const ads = modelo.sections.find((s) => s.key === 'ads');
  const banners = ads.children.find((c) => c.key === 'banners');
  const tarjeta = buildItemSubtree({
    itemsSchema: banners.itemsSchema, basePath: 'ads.banners', index: 0, data: {},
  });
  const rollout = tarjeta.children.find((c) => c.key === 'rollout');
  const segments = rollout.children.find((c) => c.key === 'segments');
  assert.equal(segments.widget, 'string-list');
  assert.deepEqual(segments.itemsSchema.enum, ['newPlayers', 'veterans', 'mpPlayers']);
  assert.equal(segments.rolloutRole, 'segments');
  assert.equal(segments.segments.length, 3);
  for (const s of segments.segments) {
    assert.ok(s.name && s.title && s.description, `segmento incompleto: ${s.name}`);
    assert.ok(segments.itemsSchema.enum.includes(s.name), `${s.name} no esta en el enum`);
  }
  // Un campo corriente no lleva nada de esto.
  const id = tarjeta.children.find((c) => c.key === 'id');
  assert.equal(id.segments, null);
  assert.equal(id.rolloutRole, null);
});

test('una seccion next-boot conserva la marca x-apply en su schema', () => {
  // Es lo que el grupo usa para avisar de que los cambios entran en el
  // siguiente arranque y no en caliente.
  const schema = {
    properties: {
      tuning: {
        type: 'object',
        'x-apply': 'next-boot',
        properties: { speed: { type: 'number' } },
      },
      ads: { type: 'object', properties: { pick: { type: 'string' } } },
    },
  };
  const modelo = buildFormModel(schema, { data: {} });
  assert.equal(modelo.sections[0].schema['x-apply'], 'next-boot');
  assert.equal(modelo.sections[1].schema['x-apply'], undefined);
});

test('todo widget que resuelve el schema real es uno que la UI sabe pintar', () => {
  // Una pista `x-ui.widget` nueva en el contrato que el dashboard no conozca
  // caeria al control de texto sin que nadie lo notara. Esto lo caza.
  const modelo = buildFormModel(schemaReal, { data: {} });
  const desconocidos = new Set();
  const recorrer = (n) => {
    if (n.kind === 'field') {
      if (!WIDGETS.includes(n.widget)) desconocidos.add(`${n.path}: ${n.widget}`);
      if (n.itemsSchema?.properties) {
        recorrer(buildItemSubtree({
          itemsSchema: n.itemsSchema, basePath: n.path, index: 0, data: {},
        }));
      }
      if (n.widget === 'object-map' && n.schema?.additionalProperties?.properties) {
        recorrer(buildItemSubtree({
          itemsSchema: n.schema.additionalProperties,
          basePath: n.path,
          index: 'x',
          data: {},
        }));
      }
    } else n.children.forEach(recorrer);
  };
  modelo.sections.forEach(recorrer);
  assert.deepEqual([...desconocidos], []);
});

// ─── Tipos con null ───────────────────────────────────────────────────

test('["number","null"] se reconoce como numero que ADMITE null', () => {
  const t = normalizeType(['number', 'null']);
  assert.deepEqual(t.types, ['number']);
  assert.equal(t.nullable, true);
});

test('un campo nullable llega al modelo marcado como tal', () => {
  // ⚠️ En `ttlMs`, null = «no mostrar nunca» y 0 = «para siempre». Si el
  // formulario no distingue null de 0, cambiar uno por otro invierte el
  // comportamiento del anuncio sin que se note en la UI.
  const modelo = buildFormModel(schemaReal, { data: {} });
  const ads = modelo.sections.find((s) => s.key === 'ads');
  const banners = ads.children.find((c) => c.key === 'banners');
  // El schema generado expresa «entero o null» como `anyOf`; el formulario lo
  // aplana antes de decidir el control, igual que aqui.
  const ttl = flattenSchema(banners.itemsSchema.properties.ttlMs);
  assert.equal(normalizeType(ttl.type).nullable, true);
});

// ─── Presencia: el riesgo de materializar defaults ─────────────────────

test('un campo ausente NO se confunde con uno a false', () => {
  const schema = {
    properties: {
      mp: {
        type: 'object',
        properties: { showButton: { type: 'boolean', default: true } },
      },
    },
  };
  const vacio = buildFormModel(schema, { data: {} });
  const puesto = buildFormModel(schema, { data: { mp: { showButton: false } } });

  const campoDe = (m) => m.sections[0].children[0];
  assert.equal(campoDe(vacio).present, false);
  assert.equal(campoDe(vacio).value, undefined);
  assert.equal(campoDe(puesto).present, true);
  assert.equal(campoDe(puesto).value, false);
});

test('un grupo entero ausente se marca ausente', () => {
  // `ads` no existe en prod.json: la UI debe decirlo y ofrecer crearlo, no
  // pintar campos vacios que pareceran definidos.
  const modelo = buildFormModel(schemaReal, { data: { schemaVersion: 1 } });
  const ads = modelo.sections.find((s) => s.key === 'ads');
  assert.equal(ads.present, false);
});

test('el modelo NO inventa valores para lo ausente', () => {
  // La garantia de "abrir y guardar sin tocar nada no cambia el fichero":
  // ningun campo ausente trae un valor que luego se escribiria.
  const modelo = buildFormModel(schemaReal, { data: { schemaVersion: 1 } });
  const hojas = [];
  const recorrer = (n) => {
    if (n.kind === 'field') hojas.push(n);
    else n.children.forEach(recorrer);
  };
  modelo.sections.forEach(recorrer);
  assert.ok(hojas.length > 50, `esperaba muchos campos, hubo ${hojas.length}`);
  for (const hoja of hojas) {
    assert.equal(
      hoja.present, false,
      `${hoja.path} deberia estar ausente con datos vacios`,
    );
    assert.equal(hoja.value, undefined, `${hoja.path} no debe traer valor`);
  }
});

test('schemaVersion no se ofrece como campo editable', () => {
  const modelo = buildFormModel(schemaReal, { data: { schemaVersion: 1 } });
  assert.equal(modelo.sections.some((s) => s.key === 'schemaVersion'), false);
  assert.equal(modelo.schemaVersion, 1);
});

// ─── Diferencias entre canales ────────────────────────────────────────

test('se senala el campo que difiere de otro canal', () => {
  const schema = {
    properties: {
      paywall: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
      },
    },
  };
  const modelo = buildFormModel(schema, {
    data: { paywall: { enabled: false } },
    otherChannels: {
      dev: { paywall: { enabled: true } },
      prod: { paywall: { enabled: false } },
    },
  });
  const campo = modelo.sections[0].children[0];
  assert.deepEqual(campo.diffs, { dev: true });   // prod coincide → no sale
});

test('dos objetos equivalentes no cuentan como diferencia', () => {
  const schema = {
    properties: {
      a: { type: 'object', properties: { l: { type: 'array', items: { type: 'string' } } } },
    },
  };
  const modelo = buildFormModel(schema, {
    data: { a: { l: ['x', 'y'] } },
    otherChannels: { dev: { a: { l: ['x', 'y'] } } },
  });
  assert.deepEqual(modelo.sections[0].children[0].diffs, {});
});

// ─── Lectura/escritura por ruta ───────────────────────────────────────

test('escribir crea los contenedores que falten', () => {
  const out = writePath({}, 'mp.retry.paywall.enabled', true);
  assert.equal(out.mp.retry.paywall.enabled, true);
});

test('escribir un indice numerico crea un ARRAY, no un objeto', () => {
  const out = writePath({}, 'ads.banners.0.id', 'x');
  assert.ok(Array.isArray(out.ads.banners), 'banners deberia ser array');
  assert.equal(out.ads.banners[0].id, 'x');
});

test('escribir no muta el original', () => {
  const original = { a: { b: 1 } };
  const copia = writePath(original, 'a.b', 2);
  assert.equal(original.a.b, 1);
  assert.equal(copia.a.b, 2);
});

test('borrar devuelve el campo a «sin definir»', () => {
  const out = deletePath({ mp: { showButton: false } }, 'mp.showButton');
  assert.equal('showButton' in out.mp, false);
});

test('borrar un elemento de lista lo saca del array', () => {
  const out = deletePath({ l: ['a', 'b', 'c'] }, 'l.1');
  assert.deepEqual(out.l, ['a', 'c']);
});

test('leer una ruta rota devuelve undefined en vez de reventar', () => {
  assert.equal(readPath({}, 'a.b.c'), undefined);
  assert.equal(readPath({ a: null }, 'a.b'), undefined);
});

// ─── Alta de elementos en listas ──────────────────────────────────────

test('un elemento nuevo trae solo requeridos y defaults', () => {
  const items = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      enabled: { type: 'boolean', default: false },
      cooldownMs: { type: ['number', 'null'] },
    },
  };
  const nuevo = blankItem(items);
  assert.deepEqual(nuevo, { id: '', enabled: false });
  assert.equal('cooldownMs' in nuevo, false, 'lo opcional no se materializa');
});

// ─── Etiquetas ────────────────────────────────────────────────────────

test('la clave se convierte en etiqueta legible', () => {
  assert.equal(humanizeKey('cohortPercent'), 'Cohort percent');
  assert.equal(humanizeKey('skippableAfterMs'), 'Skippable after ms');
});

// ─── El schema REAL entra entero ──────────────────────────────────────

test('el schema real produce las 9 secciones esperadas', () => {
  const modelo = buildFormModel(schemaReal, { data: {} });
  assert.deepEqual(
    modelo.sections.map((s) => s.key).sort(),
    [
      'ads', 'analytics', 'appUpdate', 'freewall', 'mp', 'ops', 'paywall',
      'profiling', 'wallConflict',
    ],
  );
});

test('ningun campo del schema real cae en «unsupported»', () => {
  // Si algo cae aqui es que hay una forma de campo que la UI no sabe pintar:
  // el usuario la veria como JSON crudo, que es justo lo que este dashboard
  // viene a evitar.
  const modelo = buildFormModel(schemaReal, { data: {} });
  const huerfanos = [];
  const recorrer = (n) => {
    if (n.kind === 'field') {
      if (n.widget === 'unsupported') huerfanos.push(`${n.path} (${JSON.stringify(n.types)})`);
    } else n.children.forEach(recorrer);
  };
  modelo.sections.forEach(recorrer);
  assert.deepEqual(huerfanos, []);
});
