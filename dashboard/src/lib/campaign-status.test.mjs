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
  describeCampaign,
  effectivePercent,
  effectiveReach,
  isScheduleInverted,
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
  assert.deepEqual(v.segments, ['newPlayers', 'veterans', 'mpPlayers']);
  assert.deepEqual(v.formFactors, ['phone', 'tablet', 'desktop']);
  assert.ok(v.variants.includes('ios') && v.variants.includes('android'));
  assert.equal(v.segmentDescriptors.length, 3);
  assert.equal(v.segmentDescriptors[0].name, 'newPlayers');
  assert.ok(v.segmentDescriptors[0].title && v.segmentDescriptors[0].description);
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
});
