/**
 * Tests del estado de campaña (calendario, rampa, alcance, segmentos,
 * ficha), con un `now` FIJO: el panel no puede depender de cuando se
 * ejecuta el test.
 *
 * La referencia es el evaluador del juego (`@modules/rollout/evaluate.ts`
 * del repo principal): cada test fija un comportamiento que alli tambien
 * esta fijado, para que el panel y el jugador no discrepen.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  bannerRolloutSchema,
  bucketByOf,
  collectLayers,
  COUNTRY_PATTERN,
  describeCampaign,
  describeCountries,
  describeExperiment,
  describeLayer,
  describeLocales,
  duplicateVariantNames,
  effectivePercent,
  effectiveReach,
  experimentWeightsAllZero,
  formatShare,
  globalHoldout,
  invalidCountries,
  invalidLocales,
  isScheduleInverted,
  layerOf,
  layerSharers,
  LOCALE_PATTERN,
  metaGaps,
  rampDescents,
  rampState,
  rolloutVocabulary,
  scheduleState,
  unknownSegments,
} from './campaign-status.mjs';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const schemaReal = JSON.parse(readFileSync(
  join(RAIZ, 'schemas', 'snake-classic.schema.json'), 'utf8',
));

/** 1 de julio de 2026 a mediodia UTC: el «ahora» de todos los tests. */
const AHORA = Date.UTC(2026, 6, 1, 12, 0, 0);
const AYER = '2026-06-30T12:00:00Z';
const MANANA = '2026-07-02T12:00:00Z';
const HACE_UNA_SEMANA = '2026-06-24T12:00:00Z';
const EN_UNA_SEMANA = '2026-07-08T12:00:00Z';

// ─── Calendario ───────────────────────────────────────────────────────

test('sin calendario la campaña es «siempre»', () => {
  assert.equal(scheduleState(null, AHORA), 'always');
  assert.equal(scheduleState(undefined, AHORA), 'always');
  assert.equal(scheduleState({ from: null, to: null }, AHORA), 'always');
});

test('programada / activa / caducada segun la ventana [desde, hasta)', () => {
  assert.equal(scheduleState({ from: MANANA, to: null }, AHORA), 'scheduled');
  assert.equal(scheduleState({ from: AYER, to: MANANA }, AHORA), 'active');
  assert.equal(scheduleState({ from: null, to: AYER }, AHORA), 'expired');
  // Solo «hasta», aun futuro: activa.
  assert.equal(scheduleState({ from: null, to: MANANA }, AHORA), 'active');
});

test('el extremo es inclusive por «desde» y exclusive por «hasta»', () => {
  const justoAhora = new Date(AHORA).toISOString();
  assert.equal(scheduleState({ from: justoAhora, to: null }, AHORA), 'active');
  assert.equal(scheduleState({ from: null, to: justoAhora }, AHORA), 'expired');
});

test('un extremo ilegible no acota por ese lado (como en el juego)', () => {
  assert.equal(scheduleState({ from: 'ayer', to: null }, AHORA), 'always');
  assert.equal(scheduleState({ from: 'ayer', to: MANANA }, AHORA), 'active');
});

test('calendario invertido: caducada, y se señala como invertido', () => {
  const invertido = { from: MANANA, to: AYER };
  assert.equal(isScheduleInverted(invertido), true);
  assert.equal(scheduleState(invertido, AHORA), 'expired');
  assert.equal(isScheduleInverted({ from: AYER, to: MANANA }), false);
  assert.equal(isScheduleInverted(null), false);
});

// ─── Rampa ────────────────────────────────────────────────────────────

test('sin rampa manda el porcentaje base (default 100)', () => {
  assert.equal(effectivePercent({ percent: 25 }, AHORA), 25);
  assert.equal(effectivePercent({}, AHORA), 100);
  assert.equal(effectivePercent({ percent: 25, ramp: [] }, AHORA), 25);
});

test('la rampa: manda el ULTIMO escalon que ya paso', () => {
  const cohort = {
    percent: 1,
    ramp: [
      { at: HACE_UNA_SEMANA, percent: 10 },
      { at: AYER, percent: 50 },
      { at: EN_UNA_SEMANA, percent: 100 },
    ],
  };
  assert.equal(effectivePercent(cohort, AHORA), 50);
  const estado = rampState(cohort, AHORA);
  assert.equal(estado.hasRamp, true);
  assert.equal(estado.base, 1);
  assert.equal(estado.effective, 50);
  assert.equal(estado.current.percent, 50);
  assert.equal(estado.next.percent, 100);
  assert.equal(estado.next.iso, EN_UNA_SEMANA);
});

test('antes del primer escalon manda el porcentaje base', () => {
  const cohort = { percent: 1, ramp: [{ at: MANANA, percent: 10 }] };
  assert.equal(effectivePercent(cohort, AHORA), 1);
  const estado = rampState(cohort, AHORA);
  assert.equal(estado.current, null);
  assert.equal(estado.next.percent, 10);
});

test('el orden de la lista no importa: se busca el mas reciente', () => {
  const cohort = {
    percent: 1,
    ramp: [
      { at: AYER, percent: 50 },
      { at: HACE_UNA_SEMANA, percent: 10 },
    ],
  };
  assert.equal(effectivePercent(cohort, AHORA), 50);
});

test('un escalon con fecha ilegible se ignora', () => {
  const cohort = {
    percent: 1,
    ramp: [{ at: 'el lunes', percent: 99 }, { at: AYER, percent: 10 }],
  };
  assert.equal(effectivePercent(cohort, AHORA), 10);
  assert.equal(rampState(cohort, AHORA).steps.length, 1);
});

test('⚠️ se detectan los escalones que BAJAN (rollback programado)', () => {
  const cohort = {
    percent: 1,
    ramp: [
      { at: HACE_UNA_SEMANA, percent: 10 },
      { at: AYER, percent: 5 },
      { at: EN_UNA_SEMANA, percent: 50 },
    ],
  };
  assert.deepEqual(rampDescents(cohort), [{ at: AYER, from: 10, to: 5 }]);
  // El porcentaje base cuenta como punto de partida.
  assert.deepEqual(
    rampDescents({ percent: 100, ramp: [{ at: MANANA, percent: 10 }] }),
    [{ at: MANANA, from: 100, to: 10 }],
  );
  // Una rampa sana no avisa.
  assert.deepEqual(rampDescents({
    percent: 1,
    ramp: [{ at: AYER, percent: 10 }, { at: MANANA, percent: 50 }],
  }), []);
});

// ─── Alcance real ─────────────────────────────────────────────────────

test('sin tramo, el alcance es [0, porcentaje)', () => {
  const r = effectiveReach({ percent: 30 }, AHORA);
  assert.deepEqual([r.from, r.to, r.width], [0, 30, 30]);
  assert.equal(r.audience.declared, false);
});

test('con tramo y 100 %, el alcance es el tramo', () => {
  const r = effectiveReach({ percent: 100, audience: { from: 50, to: 75 } }, AHORA);
  assert.deepEqual([r.from, r.to, r.width], [50, 75, 25]);
});

test('⚠️ el porcentaje RECORTA desde el 0: tramo 50–100 al 10 % = nadie', () => {
  // Es la trampa que el formulario no puede ver campo a campo: cada valor es
  // valido por separado y juntos no dejan entrar a nadie.
  const r = effectiveReach({ percent: 10, audience: { from: 50, to: 100 } }, AHORA);
  assert.equal(r.width, 0);
  // Y con la rampa ya en 75 %, entra el 50–75.
  const conRampa = effectiveReach({
    percent: 10,
    audience: { from: 50, to: 100 },
    ramp: [{ at: AYER, percent: 75 }],
  }, AHORA);
  assert.deepEqual([conRampa.from, conRampa.to, conRampa.width], [50, 75, 25]);
});

test('0 % no deja entrar a nadie aunque el tramo sea todo el eje', () => {
  assert.equal(effectiveReach({ percent: 0 }, AHORA).width, 0);
});

// ─── Segmentos y ficha ────────────────────────────────────────────────

test('segmentos que el juego no conoce', () => {
  assert.deepEqual(
    unknownSegments(['veterans', 'whales'], ['newPlayers', 'veterans', 'mpPlayers']),
    ['whales'],
  );
  // Sin vocabulario no se puede saber: no se avisa.
  assert.deepEqual(unknownSegments(['whales'], null), []);
  assert.deepEqual(unknownSegments(undefined, ['veterans']), []);
});

test('la ficha sin nombre o responsable se señala', () => {
  assert.deepEqual(metaGaps({ name: 'Navidad', owner: 'ana' }), []);
  assert.deepEqual(metaGaps({ name: 'Navidad', owner: '  ' }), ['owner']);
  assert.deepEqual(metaGaps({}), ['name', 'owner']);
  assert.deepEqual(metaGaps(undefined), ['name', 'owner']);
});

// ─── El vocabulario sale del schema REAL ──────────────────────────────

test('el sobre de ads.banners se encuentra en el schema generado', () => {
  const rollout = bannerRolloutSchema(schemaReal);
  assert.ok(rollout, 'deberia haber sobre');
  assert.ok(rollout.properties.segments, 'con segmentos');
  assert.ok(rollout.properties.schedule, 'con calendario');
  assert.ok(rollout.properties.cohort.properties.ramp, 'con rampa');
  assert.equal(bannerRolloutSchema(null), null);
  assert.equal(bannerRolloutSchema({ properties: {} }), null);
});

test('segmentos, variantes y dispositivos se leen del schema (con anyOf)', () => {
  const v = rolloutVocabulary(schemaReal);
  assert.equal(v.available, true);
  // El juego estrena segmentos de vez en cuando (el schema se regenera):
  // se fija que los conocidos esten y que cada nombre del enum traiga su
  // descriptor completo, no cuantos hay.
  assert.ok(v.segments.includes('newPlayers') && v.segments.includes('payers'));
  assert.deepEqual(v.formFactors, ['phone', 'tablet', 'desktop']);
  assert.ok(v.variants.includes('ios') && v.variants.includes('android'));
  assert.deepEqual(
    v.segmentDescriptors.map((s) => s.name).sort(),
    [...v.segments].sort(),
  );
  for (const s of v.segmentDescriptors) {
    assert.ok(s.title && s.description, `segmento sin explicar: ${s.name}`);
  }
  // Sin schema: vocabulario vacio, no una excepcion.
  const vacio = rolloutVocabulary(null);
  assert.equal(vacio.available, false);
  assert.equal(vacio.segments, null);
});

// ─── La descripcion completa ──────────────────────────────────────────

test('describeCampaign junta todo lo que el panel pinta', () => {
  const campana = {
    id: 'verano',
    rollout: {
      enabled: true,
      schedule: { from: AYER, to: EN_UNA_SEMANA },
      segments: ['veterans', 'whales'],
      cohort: {
        percent: 1,
        audience: { from: 0, to: 50 },
        ramp: [{ at: AYER, percent: 10 }, { at: MANANA, percent: 100 }],
      },
      meta: { name: 'Verano 2026' },
    },
  };
  const d = describeCampaign(campana, {
    now: AHORA,
    knownSegments: ['newPlayers', 'veterans', 'mpPlayers'],
  });
  assert.equal(d.enabled, true);
  assert.equal(d.schedule.state, 'active');
  assert.equal(d.schedule.label, 'activa');
  assert.equal(d.liveNow, true);
  assert.equal(d.ramp.effective, 10);
  assert.equal(d.ramp.next.percent, 100);
  assert.deepEqual([d.reach.from, d.reach.to], [0, 10]);
  assert.deepEqual(d.unknownSegments, ['whales']);
  assert.equal(d.meta.name, 'Verano 2026');
  assert.deepEqual(d.meta.gaps, ['owner']);
});

test('una campaña encendida pero caducada NO esta viva ahora', () => {
  const d = describeCampaign({
    rollout: { enabled: true, schedule: { to: AYER } },
  }, { now: AHORA });
  assert.equal(d.enabled, true);
  assert.equal(d.schedule.state, 'expired');
  assert.equal(d.liveNow, false);
});

test('una campaña sin sobre no revienta: defaults del contrato', () => {
  const d = describeCampaign({ id: 'x' }, { now: AHORA });
  assert.equal(d.enabled, false);
  assert.equal(d.schedule.state, 'always');
  assert.equal(d.ramp.hasRamp, false);
  assert.equal(d.reach.percent, 100);
  assert.deepEqual(d.segments, []);
  assert.deepEqual(d.meta.gaps, ['name', 'owner']);
  // Y lo de ADR-041: todos los idiomas y paises, eje propio, por
  // dispositivo, sin experimento.
  assert.equal(d.locales.text, 'todos');
  assert.equal(d.countries.all, true);
  assert.deepEqual(d.locales.invalid, []);
  assert.equal(d.layer, null);
  assert.equal(d.bucketBy, 'device');
  assert.equal(d.experiment, null);
});

// ─── Idiomas y paises (ADR-041) ───────────────────────────────────────

test('idiomas y paises: vacio o ausente = «todos»', () => {
  assert.deepEqual(describeLocales([]), { all: true, items: [], text: 'todos' });
  assert.equal(describeLocales(undefined).text, 'todos');
  assert.equal(describeCountries(null).all, true);
  const es = describeLocales(['es', 'pt-br']);
  assert.deepEqual([es.all, es.items, es.text], [false, ['es', 'pt-br'], 'es, pt-br']);
  assert.equal(describeCountries(['ES', 'MX']).text, 'ES, MX');
  // Lo que no sea string no cuenta (un JSON a mano puede traer de todo).
  assert.deepEqual(describeCountries(['ES', 7, null]).items, ['ES']);
});

test('paises que no son dos MAYUSCULAS; idiomas que no van en minusculas', () => {
  // El pais es el caso grave: el juego compara el del servidor (siempre en
  // mayusculas) contra la lista TAL CUAL, asi que «es» no casaria nunca.
  assert.deepEqual(
    invalidCountries(['ES', 'es', 'MEX', 'Mx', 'US']),
    ['es', 'MEX', 'Mx'],
  );
  assert.deepEqual(invalidCountries([]), []);
  assert.deepEqual(invalidCountries(undefined), []);
  assert.deepEqual(
    invalidLocales(['es', 'es-es', 'pt-br', 'ES', 'es_ES', 'Es-mx']),
    ['ES', 'es_ES', 'Es-mx'],
  );
  // El patron del schema cargado manda sobre el de respaldo; `null` cae
  // al respaldo (no a «todo vale»).
  assert.deepEqual(invalidCountries(['es'], '^[a-z]{2}$'), []);
  assert.deepEqual(invalidCountries(['es'], null), ['es']);
});

test('los patrones de idioma y pais se leen del schema real', () => {
  const v = rolloutVocabulary(schemaReal);
  assert.equal(v.countryPattern, COUNTRY_PATTERN);
  assert.equal(v.localePattern, LOCALE_PATTERN);
  assert.equal(rolloutVocabulary(null).countryPattern, null);
  assert.equal(rolloutVocabulary(null).localePattern, null);
});

// ─── Capa e identidad del sorteo ──────────────────────────────────────

test('capa: null o vacia = eje propio; solo «user» cambia la identidad', () => {
  assert.equal(layerOf({}), null);
  assert.equal(layerOf({ layer: null }), null);
  assert.equal(layerOf({ layer: '' }), null);
  assert.equal(layerOf({ layer: 'navidad26' }), 'navidad26');
  assert.equal(layerOf(undefined), null);
  assert.equal(describeLayer({}).text, 'eje propio de la sección');
  assert.equal(describeLayer({ layer: 'navidad26' }).text, 'capa navidad26');
  assert.equal(bucketByOf({}), 'device');
  assert.equal(bucketByOf({ bucketBy: 'user' }), 'user');
  assert.equal(bucketByOf({ bucketBy: 'cualquiera' }), 'device');
});

test('las capas se buscan en TODO el JSON: secciones, listas y mapas', () => {
  const datos = {
    ads: {
      banners: [
        {
          id: 'navidadAnuncio',
          rollout: { cohort: { layer: 'navidad26', audience: { from: 0, to: 50 } } },
        },
        { id: 'verano', rollout: { cohort: {} } },
        { id: 'otro', rollout: { cohort: { layer: 'navidad26' } } },
      ],
    },
    paywall: {
      rollout: { cohort: { layer: 'navidad26', audience: { from: 50, to: 100 } } },
      overrides: { ios: { rollout: { cohort: { layer: 'iosOnly' } } } },
    },
    appUpdate: { rollout: { cohort: { layer: null } } },
    ops: { holdoutPercent: 5 },
  };
  assert.deepEqual(
    collectLayers(datos).map((e) => [e.layer, e.path, e.section, e.label]),
    [
      ['navidad26', 'ads.banners.0.rollout', 'ads', 'navidadAnuncio'],
      ['navidad26', 'ads.banners.2.rollout', 'ads', 'otro'],
      ['navidad26', 'paywall.rollout', 'paywall', 'paywall'],
      ['iosOnly', 'paywall.overrides.ios.rollout', 'paywall', 'paywall.overrides.ios'],
    ],
  );
  // Quien mas comparte la capa del primer banner: otro banner de la misma
  // seccion y el muro; el panel distingue los dos casos por `section`.
  const otros = layerSharers(datos, 'navidad26', {
    exceptPath: 'ads.banners.0.rollout',
  });
  assert.deepEqual(otros.map((e) => e.label), ['otro', 'paywall']);
  // Cada uno trae su tramo (todo el eje si no declara), para ver si se pisan.
  assert.deepEqual(
    otros.map((e) => [e.audience.from, e.audience.to, e.audience.declared]),
    [[0, 100, false], [50, 100, true]],
  );
  assert.deepEqual(
    otros.filter((e) => e.section !== 'ads').map((e) => e.label),
    ['paywall'],
  );
  // Una capa que nadie mas usa: no excluye a nadie.
  assert.deepEqual(
    layerSharers(datos, 'iosOnly', { exceptPath: 'paywall.overrides.ios.rollout' }),
    [],
  );
  assert.deepEqual(layerSharers(datos, null), []);
  assert.deepEqual(collectLayers(null), []);
  assert.deepEqual(collectLayers({}), []);
});

// ─── Experimento ──────────────────────────────────────────────────────

test('experimento: cuota esperada = peso / suma, como en el juego', () => {
  const exp = {
    key: 'precioNavidad26',
    variants: [{ name: 'control', weight: 3 }, { name: 'caro', weight: 1 }],
  };
  const d = describeExperiment(exp);
  assert.equal(d.key, 'precioNavidad26');
  assert.deepEqual(
    d.variants.map((v) => [v.name, v.weight, v.share]),
    [['control', 3, 0.75], ['caro', 1, 0.25]],
  );
  assert.equal(d.text, 'control 75 % · caro 25 %');
  assert.equal(d.allZero, false);
  assert.deepEqual(d.duplicates, []);
  // Sin peso, el contrato pone 1: dos variantes sin peso son 50/50.
  const mitad = describeExperiment({ key: 'x', variants: [{ name: 'a' }, { name: 'b' }] });
  assert.equal(mitad.text, 'a 50 % · b 50 %');
  // Tres iguales: con un decimal, no «33 · 33 · 33».
  const tercios = describeExperiment({
    key: 'x', variants: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
  });
  assert.equal(tercios.text, 'a 33.3 % · b 33.3 % · c 33.3 %');
  assert.equal(describeExperiment(null), null);
  assert.equal(describeExperiment(undefined), null);
});

test('⚠️ pesos todos a 0: todo el mundo en la primera variante', () => {
  const exp = {
    key: 'x',
    variants: [{ name: 'control', weight: 0 }, { name: 'caro', weight: 0 }],
  };
  assert.equal(experimentWeightsAllZero(exp), true);
  const d = describeExperiment(exp);
  assert.equal(d.allZero, true);
  assert.deepEqual(d.variants.map((v) => v.share), [1, 0]);
  assert.equal(d.text, 'todos en la primera (control): pesos a 0');
  // Un solo 0 no es «todos a 0»: esa variante queda definida pero sin nadie.
  assert.equal(experimentWeightsAllZero({
    variants: [{ name: 'a', weight: 0 }, { name: 'b', weight: 1 }],
  }), false);
  assert.equal(experimentWeightsAllZero({ variants: [] }), false);
  assert.equal(experimentWeightsAllZero(null), false);
});

test('variantes con el nombre repetido', () => {
  assert.deepEqual(
    duplicateVariantNames({
      variants: [{ name: 'control' }, { name: 'caro' }, { name: 'control' }],
    }),
    ['control'],
  );
  assert.deepEqual(describeExperiment({
    key: 'x',
    variants: [{ name: 'a' }, { name: 'a' }, { name: 'a' }],
  }).duplicates, ['a']);
  assert.deepEqual(duplicateVariantNames({ variants: [{ name: 'a' }, { name: 'b' }] }), []);
  assert.deepEqual(duplicateVariantNames(null), []);
});

test('formatShare: entero sin decimales; si no, uno', () => {
  assert.equal(formatShare(0.75), '75 %');
  assert.equal(formatShare(1), '100 %');
  assert.equal(formatShare(0), '0 %');
  assert.equal(formatShare(0.3), '30 %');
  assert.equal(formatShare(2 / 3), '66.7 %');
});

// ─── Holdout global ───────────────────────────────────────────────────

test('holdout global: activo si ops.holdoutPercent > 0', () => {
  assert.deepEqual(globalHoldout({ ops: { holdoutPercent: 5 } }), { active: true, percent: 5 });
  assert.deepEqual(globalHoldout({ ops: { holdoutPercent: 0 } }), { active: false, percent: 0 });
  assert.deepEqual(globalHoldout({}), { active: false, percent: 0 });
  assert.deepEqual(globalHoldout(null), { active: false, percent: 0 });
  assert.deepEqual(globalHoldout({ ops: { holdoutPercent: 250 } }), { active: true, percent: 100 });
  assert.deepEqual(globalHoldout({ ops: { holdoutPercent: 'cinco' } }), { active: false, percent: 0 });
});

// ─── La descripcion completa, con lo de ADR-041 ───────────────────────

test('describeCampaign trae idiomas, paises, capa, identidad y experimento', () => {
  const d = describeCampaign({
    id: 'navidad',
    rollout: {
      enabled: true,
      locales: ['es', 'PT-br'],
      countries: ['ES', 'mx'],
      cohort: { percent: 100, layer: 'navidad26', bucketBy: 'user' },
      experiment: {
        key: 'precioNavidad26',
        variants: [{ name: 'control', weight: 1 }, { name: 'caro', weight: 1 }],
      },
    },
  }, { now: AHORA });
  assert.equal(d.locales.text, 'es, PT-br');
  assert.deepEqual(d.locales.invalid, ['PT-br']);
  assert.equal(d.countries.text, 'ES, mx');
  assert.deepEqual(d.countries.invalid, ['mx']);
  assert.equal(d.layer, 'navidad26');
  assert.equal(d.bucketBy, 'user');
  assert.equal(d.experiment.key, 'precioNavidad26');
  assert.equal(d.experiment.text, 'control 50 % · caro 50 %');
  // Los patrones del schema cargado se pueden inyectar.
  const laxo = describeCampaign(
    { rollout: { countries: ['mx'] } },
    { now: AHORA, countryPattern: '^[a-z]{2}$' },
  );
  assert.deepEqual(laxo.countries.invalid, []);
});
