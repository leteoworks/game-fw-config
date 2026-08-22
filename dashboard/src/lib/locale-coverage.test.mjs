import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hayIngles, idiomasSinTexto } from './locale-coverage.mjs';

const IDIOMAS = [
  { code: 'en', title: 'English' },
  { code: 'es', title: 'Español' },
  { code: 'pt-BR', title: 'Português (Brasil)' },
  { code: 'zh-CN', title: '简体中文' },
];
const faltan = (mapa) => idiomasSinTexto(IDIOMAS, mapa).map((l) => l.code);

test('la cobertura sigue la cadena del juego: exacto, base, variante', () => {
  // Lo que suele publicarse: el español y el portugués leen el inglés.
  assert.deepEqual(faltan({ en: {}, 'zh-CN': {} }), ['es', 'pt-BR']);
  // Por idioma base y sin distinguir mayúsculas.
  assert.deepEqual(faltan({ EN: {}, es: {}, pt: {}, zh: {} }), []);
  // Por variante regional del mismo idioma.
  assert.deepEqual(faltan({ en: {}, 'es-mx': {}, 'pt-pt': {}, 'zh-cn': {} }), []);
  assert.deepEqual(faltan({}), ['en', 'es', 'pt-BR', 'zh-CN']);
  assert.deepEqual(faltan(null), ['en', 'es', 'pt-BR', 'zh-CN']);
});

test('el inglés NO cubre: solo es la reserva', () => {
  assert.deepEqual(faltan({ en: {} }), ['es', 'pt-BR', 'zh-CN']);
  assert.equal(hayIngles({ 'en-GB': {} }), true);
  assert.equal(hayIngles({ es: {} }), false);
  assert.equal(hayIngles(undefined), false);
});
