/**
 * Contrato de lectura/validacion/escritura de los JSON de configuracion.
 *
 * El test que de verdad importa aqui es el de «validar DOS veces»: por como
 * Ajv indexa los schemas por su `$id`, compilar el mismo schema dos veces
 * lanza una excepcion. Con el dashboard eso significaba que el PRIMER
 * guardado de la sesion funcionaba y todos los siguientes fallaban — y el
 * mensaje de error (`schema with key or id … already exists`) no se parece en
 * nada a su causa ni al sintoma que ve el usuario («no se ha guardado»).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { listGames, readChannel, readSchema, readUi, validate } from './config-store.mjs';
import { V1_DIR } from './paths.mjs';

test('lista los juegos con sus canales, sin colar `assets` como juego', () => {
  const juegos = listGames();
  assert.ok(juegos.length > 0, 'deberia haber al menos un juego');
  assert.equal(juegos.some((j) => j.id === 'assets'), false);
  const snake = juegos.find((j) => j.id === 'snake-classic');
  assert.deepEqual(snake.channels, ['beta', 'dev', 'prod']);
});

test('⚠️ validar DOS veces no revienta (Ajv indexa por $id)', () => {
  const datos = readChannel('snake-classic', 'prod');
  // Sin la cache de validadores, esta segunda llamada lanzaba.
  const primera = validate('snake-classic', datos);
  const segunda = validate('snake-classic', datos);
  assert.equal(primera.ok, true);
  assert.equal(segunda.ok, true);
  // Y una tercera, por si acaso el fallo fuera de paridad.
  assert.equal(validate('snake-classic', datos).ok, true);
});

test('los tres canales publicados validan contra su schema', () => {
  for (const canal of ['prod', 'beta', 'dev']) {
    const resultado = validate('snake-classic', readChannel('snake-classic', canal));
    assert.deepEqual(
      resultado.errors, [],
      `${canal}.json no valida: ${JSON.stringify(resultado.errors)}`,
    );
  }
});

test('un valor fuera de rango se rechaza señalando el campo', () => {
  const resultado = validate('snake-classic', {
    schemaVersion: 1,
    ads: { banners: [{ id: 'x', cohortPercent: 500 }] },
  });
  assert.equal(resultado.ok, false);
  // La ruta llega con puntos para que la UI pueda resaltar el campo culpable.
  assert.ok(
    resultado.errors.some((e) => e.path === 'ads.banners.0.cohortPercent'),
    `esperaba la ruta del campo, hubo: ${JSON.stringify(resultado.errors)}`,
  );
});

test('el formato de escritura coincide con el de los ficheros del repo', () => {
  // Si el dashboard formateara distinto, cada guardado produciria un diff de
  // reformateo que enterraria el cambio real en la revision.
  for (const canal of ['prod', 'beta', 'dev']) {
    const enDisco = readFileSync(
      join(V1_DIR, 'snake-classic', `${canal}.json`), 'utf8',
    );
    const comoEscribiriamos = `${JSON.stringify(JSON.parse(enDisco), null, 2)}\n`;
    assert.equal(enDisco, comoEscribiriamos, `${canal}.json`);
  }
});

test('los textos en español se cargan y traen las dos tablas', () => {
  const ui = readUi('snake-classic');
  assert.ok(ui, 'deberia existir snake-classic.ui.json');
  assert.ok(Object.keys(ui.sections).length > 20);
  assert.ok(Object.keys(ui.fields).length > 80);
});

test('un juego sin textos degrada a null, no lanza', () => {
  assert.equal(readUi('juego-que-no-existe'), null);
});

test('el schema se lee entero', () => {
  const schema = readSchema('snake-classic');
  assert.equal(schema.additionalProperties, false);
  assert.ok(Object.keys(schema.properties).length >= 6);
});
