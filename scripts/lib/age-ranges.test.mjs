import assert from 'node:assert/strict';
import { test } from 'node:test';

import { antiguedadesVacias, motivoAntiguedadVacia } from './age-ranges.mjs';

test('sin age, o sin extremos, no hay nada que avisar', () => {
  assert.equal(motivoAntiguedadVacia(undefined), null);
  assert.equal(motivoAntiguedadVacia(null), null);
  assert.equal(motivoAntiguedadVacia({ minDays: null, maxDays: null }), null);
});

test('un intervalo con hueco es valido (decimales incluidos)', () => {
  assert.equal(motivoAntiguedadVacia({ minDays: 7, maxDays: 30 }), null);
  assert.equal(motivoAntiguedadVacia({ minDays: 30, maxDays: null }), null);
  assert.equal(motivoAntiguedadVacia({ minDays: null, maxDays: 7 }), null);
  assert.equal(motivoAntiguedadVacia({ minDays: 0, maxDays: 0.5 }), null);
});

test('maximo <= minimo es un intervalo vacio: nadie', () => {
  assert.match(motivoAntiguedadVacia({ minDays: 30, maxDays: 7 }), /invertido/);
  assert.match(motivoAntiguedadVacia({ minDays: 7, maxDays: 7 }), /invertido/);
});

test('sin minimo cuenta 0: un maximo a 0 o negativo es vacio', () => {
  assert.match(motivoAntiguedadVacia({ minDays: null, maxDays: 0 }), /\[0, 0\)/);
  assert.match(motivoAntiguedadVacia({ maxDays: -3 }), /\[0, -3\)/);
});

test('un minimo negativo invalida el sobre entero (x-invalid-value)', () => {
  assert.match(motivoAntiguedadVacia({ minDays: -1, maxDays: 7 }), /negativo/);
});

test('busca el age de cada rollout del documento, con su ruta', () => {
  const doc = {
    ads: {
      banners: [
        { id: 'a', rollout: { age: { minDays: 7, maxDays: 30 } } },
        { id: 'b', rollout: { age: { minDays: 30, maxDays: 7 } } },
      ],
    },
    paywall: { rollout: { age: { minDays: null, maxDays: 0 } } },
  };
  assert.deepEqual(
    antiguedadesVacias(doc).map((p) => p.at),
    ['ads.banners[1].rollout.age', 'paywall.rollout.age'],
  );
});

test('un campo `age` fuera del sobre no es el eje', () => {
  const doc = { perfil: { age: { minDays: 9, maxDays: 1 } } };
  assert.deepEqual(antiguedadesVacias(doc), []);
});
