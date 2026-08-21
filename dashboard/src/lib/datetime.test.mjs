/**
 * Tests de la conversion UTC ↔ hora local del widget `datetime`.
 *
 * La zona se FIJA con `process.env.TZ` (Node la respeta en caliente) para
 * que el test diga lo mismo en cualquier maquina: lo que se defiende es que
 * un operador en Madrid que teclea «14:00» guarde «12:00Z» en verano y que
 * al volver a abrir el campo vea otra vez «14:00».
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeInstant,
  formatUtc,
  isoToLocalInput,
  isValidInstant,
  localInputToIso,
  parseInstant,
} from './datetime.mjs';

const enZona = (tz, fn) => {
  const previa = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
};

test('lo que se guarda es ISO en UTC, con zona', () => {
  enZona('Europe/Madrid', () => {
    // Verano: Madrid = UTC+2.
    assert.equal(localInputToIso('2026-07-01T14:00'), '2026-07-01T12:00:00.000Z');
    // Invierno: Madrid = UTC+1.
    assert.equal(localInputToIso('2026-01-15T09:30'), '2026-01-15T08:30:00.000Z');
  });
});

test('al pintar se convierte de UTC a la hora local del navegador', () => {
  enZona('Europe/Madrid', () => {
    assert.equal(isoToLocalInput('2026-07-01T12:00:00.000Z'), '2026-07-01T14:00');
  });
  enZona('America/New_York', () => {
    assert.equal(isoToLocalInput('2026-07-01T12:00:00.000Z'), '2026-07-01T08:00');
  });
  enZona('UTC', () => {
    assert.equal(isoToLocalInput('2026-07-01T12:00:00.000Z'), '2026-07-01T12:00');
  });
});

test('ida y vuelta: lo que se teclea es lo que se vuelve a ver', () => {
  enZona('Asia/Tokyo', () => {
    const local = '2026-12-24T23:45';
    assert.equal(isoToLocalInput(localInputToIso(local)), local);
  });
});

test('un instante con OTRA zona se normaliza a UTC al pintar y guardar', () => {
  // El schema admite `+hh:mm`; el control lo lee bien y, si se retoca, lo
  // que sale es UTC.
  enZona('UTC', () => {
    assert.equal(isoToLocalInput('2026-07-01T14:00:00+02:00'), '2026-07-01T12:00');
  });
});

test('⚠️ un valor incompleto o ilegible NO se convierte (no se escribe)', () => {
  // El navegador entrega '' mientras el usuario teclea la fecha: escribirlo
  // dejaria un campo invalido en el JSON.
  assert.equal(localInputToIso(''), null);
  assert.equal(localInputToIso('2026-07'), null);
  assert.equal(localInputToIso('mañana'), null);
  assert.equal(localInputToIso(undefined), null);
  assert.equal(localInputToIso(null), null);
  // Y una fecha que no existe tampoco.
  assert.equal(localInputToIso('2026-02-31T10:00'), null);
});

test('lo ilegible se pinta como campo vacio, no como "Invalid Date"', () => {
  assert.equal(isoToLocalInput(null), '');
  assert.equal(isoToLocalInput(''), '');
  assert.equal(isoToLocalInput('no es una fecha'), '');
  assert.equal(isoToLocalInput(undefined), '');
});

test('parseInstant / isValidInstant', () => {
  assert.equal(parseInstant('2026-07-01T12:00:00Z'), Date.UTC(2026, 6, 1, 12));
  assert.equal(parseInstant('  '), null);
  assert.equal(parseInstant(42), null);
  assert.equal(isValidInstant('2026-07-01T12:00:00Z'), true);
  assert.equal(isValidInstant('ayer'), false);
});

test('debajo del campo se leen las DOS horas: la UTC guardada y la local', () => {
  enZona('Europe/Madrid', () => {
    const d = describeInstant('2026-07-01T12:00:00.000Z');
    assert.equal(d.utc, '2026-07-01 12:00 UTC');
    // Lo que importa es que lleve la hora local y el nombre de la zona.
    assert.match(d.local, /14:00/);
    assert.match(d.local, /CEST|GMT\+2|UTC\+2/);
  });
  assert.equal(describeInstant('basura'), null);
  assert.equal(formatUtc('2026-01-05T03:07:00Z'), '2026-01-05 03:07 UTC');
});
