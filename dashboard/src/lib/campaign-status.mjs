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
 *  - **Idiomas y paises** (ADR-041): listas blancas; vacias = todos. El
 *    idioma casa por prefijo (`es` vale para `es-es` y `es-mx`) y va en
 *    minusculas; el pais es ISO alfa-2 en MAYUSCULAS y lo pone el servidor
 *    desde la conexion. El juego compara el pais tal cual contra la lista,
 *    asi que un `es` en minusculas NO casa nunca: aqui se señala como
 *    formato invalido (el validador tambien lo rechaza al guardar).
 *  - **Capa** (`cohort.layer`): sustituye el eje de la seccion por uno
 *    compartido entre secciones. Quien la comparte se busca en el JSON
 *    ENTERO (secciones, listas y mapas), no en una lista fija de rutas.
 *  - **Experimento**: la cuota esperada de cada variante es peso / suma;
 *    con todos los pesos a 0, la primera se lleva a todo el mundo (es lo
 *    que hace `pickVariant` en el juego, para no dejar a nadie sin
 *    variante en silencio).
 *  - **Holdout global** (`ops.holdoutPercent`): un eje propio que deja
 *    fuera de TODAS las campañas a ese porcentaje del parque.
 *
 * ## Modulo PURO
 *
 * Entra la campaña (el objeto del JSON) y un instante `now` (ms epoch);
 * sale una descripcion. Sin DOM ni reloj propio: el `now` lo pone quien
 * llama, que es lo que permite probarlo con fechas fijas.
 */

import { parseInstant } from './datetime.mjs';
import { flattenSchema, invalidByPattern } from './schema-form.mjs';

/**
 * Patrones del contrato para idioma y pais, copiados del schema generado.
 * Son el RESPALDO cuando no hay schema cargado; con schema, el panel usa
 * los que trae (`rolloutVocabulary`), que son la verdad.
 */
export const LOCALE_PATTERN = '^[a-z]{2,3}(-[a-z0-9]{2,8})*$';
export const COUNTRY_PATTERN = '^[A-Z]{2}$';

/** Texto de cada identidad del sorteo (`cohort.bucketBy`). */
export const BUCKET_BY_TEXT = /** @type {const} */ ({
  device: 'por dispositivo',
  user: 'por cuenta (sin sesión, por dispositivo)',
});

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

/** Schema (aplanado) de los ELEMENTOS de una lista del sobre, o null. */
function listItems(rollout, key) {
  const campo = rollout?.properties?.[key];
  if (!campo) return null;
  const plano = flattenSchema(campo);
  return plano.items ? flattenSchema(plano.items) : null;
}

/** `enum` de los elementos de una lista del sobre (`variants`, `segments`…). */
function listEnum(rollout, key) {
  const items = listItems(rollout, key);
  return Array.isArray(items?.enum) ? items.enum : null;
}

/** `pattern` de los elementos de una lista del sobre (`locales`, `countries`). */
function listPattern(rollout, key) {
  const items = listItems(rollout, key);
  return typeof items?.pattern === 'string' ? items.pattern : null;
}

/**
 * Lo que el schema sabe del sobre: las listas cerradas, los segmentos con
 * su explicacion y los patrones de idioma y pais. Es lo que el panel usa
 * para avisar de un segmento desconocido o de un pais mal escrito, y lo
 * que la ayuda usa para enseñar la lista REAL.
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
    localePattern: listPattern(rollout, 'locales'),
    countryPattern: listPattern(rollout, 'countries'),
  };
}

// ─── Idiomas y paises ─────────────────────────────────────────────────

/**
 * Una lista blanca del sobre, descrita: `all` si esta vacia o ausente
 * (= todos), los elementos (solo strings) y un texto corto.
 */
export function describeWhitelist(list) {
  const items = Array.isArray(list)
    ? list.filter((v) => typeof v === 'string')
    : [];
  return {
    all: items.length === 0,
    items,
    text: items.length === 0 ? 'todos' : items.join(', '),
  };
}

/** Idiomas a los que llega la campaña («todos» si no restringe). */
export function describeLocales(locales) {
  return describeWhitelist(locales);
}

/** Paises a los que llega la campaña («todos» si no restringe). */
export function describeCountries(countries) {
  return describeWhitelist(countries);
}

/**
 * Idiomas que no cumplen el formato (BCP-47 en minusculas). El juego los
 * compara en minusculas, asi que un `ES` funcionaria… pero el validador lo
 * rechaza al guardar, y la regla es una sola: minusculas.
 */
export function invalidLocales(locales, pattern = LOCALE_PATTERN) {
  return invalidByPattern(locales, pattern ?? LOCALE_PATTERN);
}

/**
 * Paises que no son dos MAYUSCULAS. Aqui el fallo seria MUDO en el juego:
 * compara el pais del servidor (siempre en mayusculas) contra la lista tal
 * cual, asi que `es` no casaria con nadie, nunca.
 */
export function invalidCountries(countries, pattern = COUNTRY_PATTERN) {
  return invalidByPattern(countries, pattern ?? COUNTRY_PATTERN);
}

// ─── Capa, identidad del sorteo y experimento ─────────────────────────

/** Capa de exclusion mutua del sobre, o `null` (eje propio de la seccion). */
export function layerOf(cohort) {
  const l = cohort?.layer;
  return typeof l === 'string' && l.length > 0 ? l : null;
}

/** La capa, descrita: `null` de capa = el eje propio de la seccion. */
export function describeLayer(cohort) {
  const layer = layerOf(cohort);
  return {
    layer,
    text: layer === null ? 'eje propio de la sección' : `capa ${layer}`,
  };
}

/** Identidad con la que se sortea (`device` salvo que diga `user`). */
export function bucketByOf(cohort) {
  return cohort?.bucketBy === 'user' ? 'user' : 'device';
}

/** Peso de una variante, con el default del contrato (1). */
function weightOf(variant) {
  const w = variant?.weight;
  return typeof w === 'number' && Number.isFinite(w) ? w : 1;
}

/** El experimento del sobre si tiene forma de tal, o `null`. */
export function experimentOf(rollout) {
  const e = rollout?.experiment;
  if (!e || typeof e !== 'object' || !Array.isArray(e.variants)) return null;
  return e;
}

/**
 * Variantes con su cuota ESPERADA (peso / suma de pesos), 0-1.
 *
 * Con todos los pesos a 0 la primera se lleva el 100 % y las demas el 0:
 * es lo que hace `pickVariant` en el juego (dejar a la gente sin variante
 * seria un fallo mudo), y el panel tiene que contarlo igual.
 */
export function experimentShares(experiment) {
  const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
  const total = variants.reduce((acc, v) => acc + weightOf(v), 0);
  return variants.map((v, index) => {
    const weight = weightOf(v);
    let share;
    if (total > 0) share = weight / total;
    else share = index === 0 ? 1 : 0;
    return {
      name: typeof v?.name === 'string' ? v.name : '',
      weight,
      share,
    };
  });
}

/** `0.75` → «75 %»; `1/3` → «33.3 %». */
export function formatShare(share) {
  const p = Math.round(share * 1000) / 10;
  return `${Number.isInteger(p) ? p : p.toFixed(1)} %`;
}

/** Nombres de variante repetidos: la telemetria no sabria cual gano. */
export function duplicateVariantNames(experiment) {
  const vistos = new Set();
  const repes = new Set();
  for (const v of experiment?.variants ?? []) {
    const n = v?.name;
    if (typeof n !== 'string') continue;
    if (vistos.has(n)) repes.add(n);
    vistos.add(n);
  }
  return [...repes];
}

/** ¿Todos los pesos a 0? (Entonces todo el mundo cae en la primera.) */
export function experimentWeightsAllZero(experiment) {
  const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
  return variants.length > 0 && variants.every((v) => weightOf(v) <= 0);
}

/**
 * El experimento, descrito para el panel: clave, variantes con cuota,
 * texto corto («control 75 % · caro 25 %»), y los dos fallos que el
 * validador no ve (nombres repetidos, pesos todos a 0). `null` sin
 * experimento.
 */
export function describeExperiment(experiment) {
  const exp = experiment && typeof experiment === 'object' ? experiment : null;
  if (!exp) return null;
  const variants = experimentShares(exp);
  const allZero = experimentWeightsAllZero(exp);
  const nombre = (v) => v.name || '(sin nombre)';
  let text;
  if (variants.length === 0) text = 'sin variantes';
  else if (allZero) text = `todos en la primera (${nombre(variants[0])}): pesos a 0`;
  else text = variants.map((v) => `${nombre(v)} ${formatShare(v.share)}`).join(' · ');
  return {
    key: typeof exp.key === 'string' ? exp.key : '',
    variants,
    allZero,
    duplicates: duplicateVariantNames(exp),
    text,
  };
}

// ─── Capas compartidas en TODO el JSON, y holdout global ──────────────

/** Etiqueta corta de quien lleva un sobre: su `id` si lo tiene, o su ruta. */
function holderLabel(nodo, ruta) {
  if (typeof nodo?.id === 'string' && nodo.id.trim() !== '') return nodo.id.trim();
  return ruta.join('.') || '(raíz)';
}

/**
 * Todos los sobres del JSON que declaran capa, esten donde esten: en una
 * seccion (`paywall.rollout`), en una lista (`ads.banners.2.rollout`) o en
 * un mapa (`paywall.overrides.ios.rollout`).
 *
 * Se recorre el JSON entero en vez de una lista fija de rutas: una seccion
 * nueva con sobre aparece sola, y una lista fija seria la segunda verdad
 * que se desincroniza al primer cambio.
 */
export function collectLayers(data) {
  const out = [];
  const visitar = (nodo, ruta) => {
    if (!nodo || typeof nodo !== 'object') return;
    if (Array.isArray(nodo)) {
      nodo.forEach((hijo, i) => visitar(hijo, [...ruta, String(i)]));
      return;
    }
    const layer = layerOf(nodo.rollout?.cohort);
    if (layer !== null) {
      out.push({
        layer,
        path: [...ruta, 'rollout'].join('.'),
        section: ruta[0] ?? '',
        label: holderLabel(nodo, ruta),
        // El tramo, para que el panel pueda decir si dos sobres de la misma
        // capa son estancos (0–50 / 50–100) o se pisan.
        audience: audienceOf(nodo.rollout.cohort),
      });
    }
    for (const [clave, hijo] of Object.entries(nodo)) {
      if (clave === 'rollout') continue;
      visitar(hijo, [...ruta, clave]);
    }
  };
  visitar(data, []);
  return out;
}

/**
 * Quien mas usa la capa `layer`, sin contar el sobre de `exceptPath`. Cada
 * entrada trae `section`, para distinguir «compartida con OTRA seccion»
 * (que es para lo que existe la capa) de «otra campaña de la misma».
 */
export function layerSharers(data, layer, { exceptPath = null } = {}) {
  if (typeof layer !== 'string' || layer === '') return [];
  return collectLayers(data).filter(
    (e) => e.layer === layer && e.path !== exceptPath,
  );
}

/** Holdout global (`ops.holdoutPercent`): activo si es mayor que 0. */
export function globalHoldout(data) {
  const p = data?.ops?.holdoutPercent;
  const percent = typeof p === 'number' && Number.isFinite(p)
    ? Math.min(Math.max(p, 0), 100)
    : 0;
  return { active: percent > 0, percent };
}

/**
 * Todo lo que el panel de campañas necesita de UNA campaña, de una vez.
 *
 * `knownSegments: null` = no hay schema cargado → no se avisa de segmentos
 * desconocidos (no se puede saber; mejor callar que inventar). Los
 * patrones de idioma y pais si tienen respaldo (son del contrato), asi
 * que un pais en minusculas se señala con o sin schema.
 */
export function describeCampaign(campaign, {
  now,
  knownSegments = null,
  localePattern = LOCALE_PATTERN,
  countryPattern = COUNTRY_PATTERN,
} = {}) {
  const rollout = campaign?.rollout ?? {};
  const cohort = rollout.cohort ?? {};
  const schedule = rollout.schedule ?? null;
  const segmentos = Array.isArray(rollout.segments) ? rollout.segments : [];
  const meta = rollout.meta ?? {};
  const estado = scheduleState(schedule, now);
  const idiomas = describeLocales(rollout.locales);
  const paises = describeCountries(rollout.countries);
  return {
    locales: { ...idiomas, invalid: invalidLocales(idiomas.items, localePattern) },
    countries: { ...paises, invalid: invalidCountries(paises.items, countryPattern) },
    layer: layerOf(cohort),
    bucketBy: bucketByOf(cohort),
    experiment: describeExperiment(experimentOf(rollout)),
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
