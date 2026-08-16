/**
 * Guard de COBERTURA: ningun campo del schema puede quedarse sin explicar.
 *
 * ## Por que esto es un test y no una buena intencion
 *
 * Las etiquetas y explicaciones viven en `schemas/<juego>.ui.json`, separadas
 * del schema. Esa separacion tiene una ventaja (el contrato no se mezcla con
 * la documentacion de producto) y un riesgo evidente: que el schema crezca y
 * los textos no.
 *
 * El sintoma de esa deriva no seria una excepcion sino algo peor: un campo
 * nuevo apareceria en el dashboard con su clave en ingles humanizada y SIN
 * ninguna explicacion, indistinguible de un campo que nadie ha considerado
 * importante. Y como el dashboard existe justo para que alguien pueda cambiar
 * la configuracion sabiendo lo que toca, un campo sin explicar es un campo que
 * se toca a ciegas.
 *
 * Asi que la deriva se convierte en un test rojo con el nombre del campo
 * delante.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildFormModel, buildItemSubtree, lookupMeta } from './schema-form.mjs';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const SCHEMAS = join(RAIZ, 'schemas');

/** Juegos que tienen schema Y fichero de textos. */
function juegosConUi() {
  return readdirSync(SCHEMAS)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => f.replace('.schema.json', ''))
    .filter((id) => {
      try {
        readFileSync(join(SCHEMAS, `${id}.ui.json`), 'utf8');
        return true;
      } catch {
        return false;
      }
    });
}

/** Recorre TODO el arbol, incluidos elementos de lista y claves de mapa. */
function recorrerTodo(modelo, visitar) {
  const recorrer = (n) => {
    visitar(n);
    (n.children ?? []).forEach(recorrer);
    if (n.itemsSchema?.properties) {
      recorrer(buildItemSubtree({
        itemsSchema: n.itemsSchema, basePath: n.path, index: 0, data: {},
      }));
    }
    if (n.widget === 'object-map' && n.schema?.additionalProperties?.properties) {
      recorrer(buildItemSubtree({
        itemsSchema: n.schema.additionalProperties,
        basePath: n.path,
        index: 'ejemplo',
        data: {},
      }));
    }
  };
  modelo.sections.forEach(recorrer);
}

for (const gameId of juegosConUi()) {
  const schema = JSON.parse(readFileSync(
    join(SCHEMAS, `${gameId}.schema.json`), 'utf8',
  ));
  const ui = JSON.parse(readFileSync(
    join(SCHEMAS, `${gameId}.ui.json`), 'utf8',
  ));

  test(`${gameId}: todo campo tiene etiqueta y explicacion en español`, () => {
    const modelo = buildFormModel(schema, { data: {}, ui });
    const sinTexto = [];
    recorrerTodo(modelo, (n) => {
      const tabla = n.kind === 'group'
        ? { ...ui.sections, ...ui.fields }
        : ui.fields;
      const meta = lookupMeta(tabla, n.generic);
      if (!meta.label || !meta.help) {
        sinTexto.push(`${n.kind === 'group' ? '[grupo]' : '[campo]'} ${n.generic}`);
      }
    });
    // El mensaje lleva las rutas: quien anada un campo al schema tiene que
    // poder ver de un vistazo que le falta por escribir.
    assert.deepEqual(
      sinTexto, [],
      `Faltan textos en schemas/${gameId}.ui.json:\n  ${sinTexto.join('\n  ')}`,
    );
  });

  test(`${gameId}: no sobran textos de campos que ya no existen`, () => {
    // La deriva contraria: un campo se retira del schema y su explicacion se
    // queda. No rompe nada, pero convierte el fichero en un cementerio donde
    // ya no se distingue lo vigente de lo muerto.
    const modelo = buildFormModel(schema, { data: {}, ui });
    const vivas = new Set();
    recorrerTodo(modelo, (n) => vivas.add(n.generic));

    const usadas = new Set();
    for (const generica of vivas) {
      for (const tabla of [ui.sections ?? {}, ui.fields ?? {}]) {
        for (const clave of Object.keys(tabla)) {
          if (lookupMeta({ [clave]: tabla[clave] }, generica).label) {
            usadas.add(clave);
          }
        }
      }
    }

    const huerfanas = [
      ...Object.keys(ui.sections ?? {}),
      ...Object.keys(ui.fields ?? {}),
    ].filter((k) => !usadas.has(k));

    assert.deepEqual(
      huerfanas, [],
      `Sobran entradas en schemas/${gameId}.ui.json (ya no hay tal campo):\n`
      + `  ${huerfanas.join('\n  ')}`,
    );
  });

  test(`${gameId}: las explicaciones estan en español, no en ingles`, () => {
    // Un guard tosco pero efectivo: si alguien copia y pega la descripcion en
    // ingles del contrato, esto lo caza. Se buscan palabras funcionales que no
    // existen en español.
    const INGLES = /\b(the|with|when|which|from|that|this|will|should|must)\b/i;
    const sospechosas = [];
    for (const tabla of [ui.sections ?? {}, ui.fields ?? {}]) {
      for (const [clave, meta] of Object.entries(tabla)) {
        if (meta.help && INGLES.test(meta.help)) {
          sospechosas.push(`${clave}: "${meta.help.slice(0, 60)}…"`);
        }
      }
    }
    assert.deepEqual(sospechosas, [], sospechosas.join('\n  '));
  });
}
