/**
 * Estado de una campaña AHORA, deducido de su sobre de despliegue.
 *
 * El formulario enseña cada campo por separado (el `desde` del calendario,
 * el escalon 3 de la rampa…) y eso no contesta lo que un operador quiere
 * saber antes de publicar: «¿esta campaña esta viva ahora mismo?», «¿a que
 * porcentaje esta la rampa hoy?», «¿a quien llega de verdad?». Este modulo
 * lo calcula con LA MISMA semantica que el evaluador del juego
 * (`@modules/rollout/evaluate.ts` del repo principal), para que el panel de
 * campañas no contradiga lo que luego ve el jugador.
 *
 * ## Lo que replica del evaluador (y hay que mantener en sintonia)
 *
 *  - **Calendario**: ventana `[from, to)`. Un extremo ausente o ilegible no
 *    acota por ese lado; sin calendario, siempre.
 *  - **Rampa**: el porcentaje vigente es el del ULTIMO escalon cuyo instante
 *    ya paso; antes del primero (o sin rampa) manda `cohort.percent`. El
 *    orden de la lista no importa; un escalon con fecha ilegible se ignora.
 *  - **Alcance real**: el porcentaje recorta el eje DESDE CERO (`posicion <
 *    porcentaje`) y el tramo se aplica ENCIMA (`desde <= posicion < hasta`).
 *    Asi que el publico real de una campaña es `[desde, min(hasta, %))`: un
 *    tramo 50–100 con la rampa al 10 % no deja entrar a NADIE todavia.
 *  - **Segmentos**: el jugador tiene que cumplir TODOS; un nombre que el
 *    juego no conoce no deja entrar a nadie (fail-closed).
 *
 * ## Modulo PURO
 *
 * Entra la campaña (el objeto del JSON) y un instante `now` (ms epoch);
 * sale una descripcion. Sin DOM ni reloj propio: el `now` lo pone quien
 * llama, que es lo que permite probarlo con fechas fijas.
 */

import { parseInstant } from './datetime.mjs';
import { flattenSchema } from './schema-form.mjs';

/** Estados temporales de una campaña segun su calendario. */
export const SCHEDULE_STATES = /** @type {const} */ ({
  always: 'siempre',
  scheduled: 'programada',
  active: 'activa',
  expired: 'caducada',
});

/**
 * ¿En que punto del calendario esta la campaña?
 *
 *  - `always`: sin calendario (o con los dos extremos vacios).
 *  - `scheduled`: `from` aun no ha llegado.
 *  - `expired`: `to` ya paso (gana sobre `scheduled` si el calendario esta
 *    invertido: en ese caso no se vera nunca, y «caducada» lo dice mejor).
 *  - `active`: dentro de la ventana.
 */
export function scheduleState(schedule, now) {
  if (!schedule || typeof schedule !== 'object') return 'always';
  const from = parseInstant(schedule.from);
  const to = parseInstant(schedule.to);
  if (from === null && to === null) return 'always';
  if (to !== null && now >= to) return 'expired';
  if (from !== null && now < from) return 'scheduled';
  return 'active';
}

/** Calendario con `desde >= hasta`: no estara activo NUNCA. */
export function isScheduleInverted(schedule) {
  if (!schedule || typeof schedule !== 'object') return false;
  const from = parseInstant(schedule.from);
  const to = parseInstant(schedule.to);
  return from !== null && to !== null && from >= to;
}

/** Porcentaje base declarado (sin rampa), con el default del contrato. */
function basePercent(cohort) {
  const p = cohort?.percent;
  return typeof p === 'number' && Number.isFinite(p) ? p : 100;
}

/**
 * Escalones de la rampa con fecha legible, ordenados por instante. Los
 * ilegibles se descartan, igual que hace el juego.
 */
export function rampSteps(ramp) {
  if (!Array.isArray(ramp)) return [];
  return ramp
    .map((step, index) => ({
      index,
      at: parseInstant(step?.at),
      iso: step?.at ?? null,
      percent: typeof step?.percent === 'number' ? step.percent : null,
    }))
    .filter((s) => s.at !== null && s.percent !== null)
    .sort((a, b) => a.at - b.at);
}

/** Porcentaje VIGENTE ahora: la rampa aplicada sobre el porcentaje base. */
export function effectivePercent(cohort, now) {
  const pasados = rampSteps(cohort?.ramp).filter((s) => s.at <= now);
  if (pasados.length === 0) return basePercent(cohort);
  return pasados[pasados.length - 1].percent;
}

/**
 * Donde esta la rampa ahora: el escalon vigente, el siguiente y el
 * porcentaje efectivo. `hasRamp: false` = sin rampa (manda el porcentaje).
 */
export function rampState(cohort, now) {
  const steps = rampSteps(cohort?.ramp);
  const base = basePercent(cohort);
  if (steps.length === 0) {
    return { hasRamp: false, base, effective: base, current: null, next: null, steps };
  }
  const pasados = steps.filter((s) => s.at <= now);
  const futuros = steps.filter((s) => s.at > now);
  const current = pasados.length > 0 ? pasados[pasados.length - 1] : null;
  const next = futuros.length > 0 ? futuros[0] : null;
  return {
    hasRamp: true,
    base,
    effective: current ? current.percent : base,
    current,
    next,
    steps,
  };
}

/**
 * Escalones que BAJAN el porcentaje respecto al vigente justo antes (el
 * porcentaje base cuenta como punto de partida).
 *
 * Una rampa existe para SUBIR sin publicar en cada paso. Un escalon que
 * baja es un rollback programado, y eso no se hace a ciegas: en el mejor
 * caso es un typo (10 → 5 → 50), en el peor quita la feature a gente que
 * ya la tenia en mitad de la noche.
 */
export function rampDescents(cohort) {
  const steps = rampSteps(cohort?.ramp);
  const out = [];
  let previo = basePercent(cohort);
  for (const step of steps) {
    if (step.percent < previo) {
      out.push({ at: step.iso, from: previo, to: step.percent });
    }
    previo = step.percent;
  }
  return out;
}

/** Tramo declarado, o todo el eje si no hay. */
export function audienceOf(cohort) {
  const a = cohort?.audience;
  if (!a || typeof a.from !== 'number' || typeof a.to !== 'number') {
    return { from: 0, to: 100, declared: false };
  }
  return { from: a.from, to: a.to, declared: true };
}

/**
 * A quien llega DE VERDAD la campaña ahora: el tramo recortado por el
 * porcentaje efectivo. `width <= 0` = no entra nadie.
 *
 * ⚠️ El porcentaje no escala el tramo, lo RECORTA desde el 0 del eje: es lo
 * que hace el evaluador (`posicion < porcentaje` y, aparte, `desde <=
 * posicion < hasta`). Por eso un tramo 50–100 al 10 % esta vacio.
 */
export function effectiveReach(cohort, now) {
  const tramo = audienceOf(cohort);
  const percent = effectivePercent(cohort, now);
  const techo = percent >= 100 ? 100 : Math.max(0, percent);
  const to = Math.min(tramo.to, techo);
  return {
    from: tramo.from,
    to,
    width: Math.max(0, to - tramo.from),
    percent,
    audience: tramo,
  };
}

/** Nombres de segmento que el juego NO conoce (no dejan entrar a nadie). */
export function unknownSegments(segments, known) {
  if (!Array.isArray(segments) || !Array.isArray(known)) return [];
  return segments.filter((s) => !known.includes(s));
}

/** Campos de la ficha que faltan: sin ellos la auditoria no sabe de quien es. */
export function metaGaps(meta) {
  const falta = (k) => typeof meta?.[k] !== 'string' || meta[k].trim() === '';
  return ['name', 'owner'].filter(falta);
}

/**
 * Schema (aplanado) del sobre de una campaña de `ads.banners`, o `null` si
 * el schema no lo trae. Se aplana nivel a nivel porque el generador expresa
 * «X o null» como `anyOf`.
 */
export function bannerRolloutSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;
  const paso = (s, key) => {
    const plano = flattenSchema(s ?? {});
    const hijo = plano.properties?.[key];
    return hijo ? flattenSchema(hijo) : null;
  };
  const ads = paso(schema, 'ads');
  const banners = ads ? paso(ads, 'banners') : null;
  const item = banners?.items ? flattenSchema(banners.items) : null;
  return item ? paso(item, 'rollout') : null;
}

/** `enum` de los elementos de una lista del sobre (`variants`, `segments`…). */
function listEnum(rollout, key) {
  const campo = rollout?.properties?.[key];
  if (!campo) return null;
  const plano = flattenSchema(campo);
  const items = plano.items ? flattenSchema(plano.items) : null;
  return Array.isArray(items?.enum) ? items.enum : null;
}

/**
 * Lo que el schema sabe del sobre: las listas cerradas y los segmentos con
 * su explicacion. Es lo que el panel usa para avisar de un segmento
 * desconocido y lo que la ayuda usa para enseñar la lista REAL.
 */
export function rolloutVocabulary(schema) {
  const rollout = bannerRolloutSchema(schema);
  const segmentos = rollout?.properties?.segments
    ? flattenSchema(rollout.properties.segments)
    : null;
  const descriptores = Array.isArray(segmentos?.['x-segments'])
    ? segmentos['x-segments']
    : [];
  return {
    available: rollout !== null,
    variants: listEnum(rollout, 'variants'),
    formFactors: listEnum(rollout, 'formFactors'),
    segments: listEnum(rollout, 'segments'),
    segmentDescriptors: descriptores,
  };
}

/**
 * Todo lo que el panel de campañas necesita de UNA campaña, de una vez.
 *
 * `knownSegments: null` = no hay schema cargado → no se avisa de segmentos
 * desconocidos (no se puede saber; mejor callar que inventar).
 */
export function describeCampaign(campaign, { now, knownSegments = null } = {}) {
  const rollout = campaign?.rollout ?? {};
  const cohort = rollout.cohort ?? {};
  const schedule = rollout.schedule ?? null;
  const segmentos = Array.isArray(rollout.segments) ? rollout.segments : [];
  const meta = rollout.meta ?? {};
  const estado = scheduleState(schedule, now);
  return {
    enabled: rollout.enabled === true,
    schedule: {
      state: estado,
      label: SCHEDULE_STATES[estado],
      from: schedule?.from ?? null,
      to: schedule?.to ?? null,
      inverted: isScheduleInverted(schedule),
    },
    /** Viva AHORA = encendida y dentro de su calendario. */
    liveNow: rollout.enabled === true
      && (estado === 'active' || estado === 'always'),
    ramp: rampState(cohort, now),
    descents: rampDescents(cohort),
    reach: effectiveReach(cohort, now),
    segments: segmentos,
    unknownSegments: unknownSegments(segmentos, knownSegments),
    meta: {
      name: typeof meta.name === 'string' ? meta.name : '',
      owner: typeof meta.owner === 'string' ? meta.owner : '',
      gaps: metaGaps(meta),
    },
  };
}
