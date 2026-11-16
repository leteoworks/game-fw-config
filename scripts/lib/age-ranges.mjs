/**
 * Antiguedades (`rollout.age`) que no dejan entrar a NADIE.
 *
 * El contrato del juego (`AgeRangeSchema` de `@modules/rollout/rule.ts` del
 * repo principal) coacciona a "nadie" (`{ minDays: 0, maxDays: 0 }`,
 * fail-closed) un intervalo vacio o invertido: `maxDays <= minDays` (sin
 * minimo cuenta 0, asi que un maximo negativo o a 0 tambien). Y un
 * `minDays` negativo no valida, con lo que el sobre entero cae a ese mismo
 * "nadie" (`x-invalid-value`). El JSON Schema no puede expresar la regla
 * entre los dos campos, asi que el ajv la deja pasar: la campaña se
 * publicaria y no la veria ningun jugador, sin que nada avise. Mismo caso
 * que el tramo invertido (`tramosVacios` de `validate.mjs`).
 *
 * Solo se mira el `age` que cuelga DIRECTAMENTE de un `rollout` (el sobre),
 * no cualquier clave `age` del documento: una seccion podria tener un campo
 * con ese nombre que no sea el eje.
 */

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Motivo por el que este `age` no deja entrar a nadie, o `null` si esta
 * bien (o no restringe). Lo que no es un numero lo caza ya el schema.
 */
export function motivoAntiguedadVacia(age) {
  if (age === null || typeof age !== 'object' || Array.isArray(age)) {
    return null;
  }
  const { minDays, maxDays } = age;
  if (esNumero(minDays) && minDays < 0) {
    return `desde el dia ${minDays} es negativo`;
  }
  if (esNumero(maxDays)) {
    const bajo = esNumero(minDays) ? minDays : 0;
    if (maxDays <= bajo) {
      return `intervalo vacio o invertido [${bajo}, ${maxDays})`;
    }
  }
  return null;
}

/**
 * Todos los `rollout.age` del documento que no dejan entrar a nadie, con
 * su ruta. Recorre secciones, listas y mapas (el sobre es comun a todos).
 */
export function antiguedadesVacias(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => antiguedadesVacias(item, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (key === 'rollout' && value !== null && typeof value === 'object') {
      const motivo = motivoAntiguedadVacia(value.age);
      if (motivo !== null) {
        out.push({
          at: `${at}.age`,
          minDays: value.age.minDays ?? null,
          maxDays: value.age.maxDays ?? null,
          motivo,
        });
      }
    }
    out.push(...antiguedadesVacias(value, at));
  }
  return out;
}
