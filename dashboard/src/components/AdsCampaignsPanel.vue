<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  describeCampaign,
  rolloutVocabulary,
} from '../lib/campaign-status.mjs';
import { formatLocal } from '../lib/datetime.mjs';

/**
 * Mapa de CAMPAÑAS de publicidad.
 *
 * ## Por que existe, si el formulario ya edita todos los campos
 *
 * El formulario generado del schema es exacto pero no da la vista de
 * conjunto, y con hasta 20 campañas simultaneas la pregunta operativa
 * no es "que dice el campo `hasta` del tramo de la campaña 7" sino "¿queda
 * gente sin ningun anuncio?", "¿hay dos campañas peleandose por el
 * mismo publico?" y, desde ADR-040, "¿cual esta VIVA hoy, a que
 * porcentaje va su rampa y a quien llega de verdad?". Eso no se ve leyendo
 * una lista de formularios: se ve en un dibujo del eje del parque y en una
 * tabla con el estado de cada una AHORA.
 *
 * Por eso este panel es de LECTURA (salvo la politica de reparto, que
 * es una decision de una sola linea): el detalle se sigue editando en
 * el formulario de abajo, y aqui se comprueba que el conjunto tiene
 * sentido antes de publicar.
 *
 * ## Lo que significa «viva ahora»
 *
 * Encendida (`rollout.enabled`) Y dentro de su calendario. El mapa y los
 * avisos de conjunto (huecos, solapes, tapadas) se calculan solo con las
 * vivas y con su ALCANCE REAL (el tramo recortado por el porcentaje
 * efectivo de la rampa): una campaña caducada o una programada para el mes
 * que viene no cubre a nadie hoy, y pintarla como si cubriera escondería
 * un hueco. Los calculos viven en `lib/campaign-status.mjs`, con tests,
 * y replican la semantica del evaluador del juego.
 */

const props = defineProps({
  /** El JSON completo en edicion. */
  datos: { type: Object, required: true },
  /** El JSON Schema del juego: de el salen los segmentos que existen. */
  schema: { type: Object, default: null },
});

const emit = defineEmits(['set']);

/**
 * «Ahora», refrescado cada medio minuto: una campaña programada para las
 * 12:00 tiene que pasar a «activa» sin recargar la pagina. Es el reloj de
 * ESTA maquina; el juego usa el del servidor, que para lo que aqui se
 * decide (¿esta viva hoy?) da lo mismo salvo que este ordenador ande mal
 * de hora.
 */
const ahora = ref(Date.now());
let temporizador = null;
onMounted(() => {
  temporizador = setInterval(() => { ahora.value = Date.now(); }, 30_000);
});
onUnmounted(() => clearInterval(temporizador));

const ads = computed(() => props.datos?.ads ?? null);
const campanas = computed(() => ads.value?.banners ?? []);
const politica = computed(() => ads.value?.pick ?? 'order');

/** El boton de panico de la seccion `ops`: pausa TODAS las campañas. */
const pausadas = computed(() => props.datos?.ops?.pauseCampaigns === true);
const motivoPausa = computed(() => {
  const nota = props.datos?.ops?.pauseNote;
  return typeof nota === 'string' ? nota.trim() : '';
});

/** Lo que el schema sabe del sobre (segmentos reales, sobre todo). */
const vocabulario = computed(() => rolloutVocabulary(props.schema));

const POLITICAS = [
  {
    valor: 'order',
    etiqueta: 'Orden',
    resumen: 'Gana la primera campaña aplicable de la lista.',
  },
  {
    valor: 'weighted',
    etiqueta: 'Sorteo por peso',
    resumen: 'Se sortea en cada arranque: el mismo jugador va rotando.',
  },
  {
    valor: 'sticky',
    etiqueta: 'Fijo por jugador',
    resumen: 'Reparte por peso, pero cada jugador ve siempre la misma.',
  },
];

/** Color estable por posicion, para que el mapa y la lista concuerden. */
const COLORES = [
  '#4f8cff', '#ff9f6e', '#7ee081', '#c9a7ff', '#ffd54a',
  '#5ad2d2', '#ff8fa3', '#a0d468', '#f4a261', '#9aa5b1',
];
const color = (i) => COLORES[i % COLORES.length];

const fecha = (iso) => (iso ? formatLocal(iso) : '');

/** Texto corto de la rampa: donde esta y que viene despues. */
function resumenRampa(rampa) {
  if (!rampa.hasRamp) return 'sin rampa';
  const vigente = rampa.current
    ? `${rampa.current.percent} % desde ${fecha(rampa.current.iso)}`
    : `${rampa.base} % (base, antes del primer escalón)`;
  const siguiente = rampa.next
    ? ` → ${rampa.next.percent} % el ${fecha(rampa.next.iso)}`
    : ' · último escalón';
  return vigente + siguiente;
}

/** Texto corto del calendario: el estado y la ventana en hora local. */
function resumenCalendario(estado) {
  if (estado.state === 'always') return 'siempre (sin calendario)';
  const desde = estado.from ? `desde ${fecha(estado.from)}` : 'desde ya';
  const hasta = estado.to ? `hasta ${fecha(estado.to)}` : 'sin fin';
  return `${desde} · ${hasta}`;
}

const filas = computed(() => campanas.value.map((c, i) => {
  const d = describeCampaign(c, {
    now: ahora.value,
    knownSegments: vocabulario.value.segments,
  });
  const tramo = d.reach.audience;
  return {
    indice: i,
    // Una campaña recien añadida tiene `id: ''`: sin esto los avisos
    // empezarian por un hueco («  no tiene nombre…») y no se sabria de cual
    // hablan.
    id: (typeof c?.id === 'string' && c.id.trim()) || '(sin id)',
    activa: d.enabled,
    viva: d.liveNow,
    estado: d.schedule,
    calendario: resumenCalendario(d.schedule),
    rampa: d.ramp,
    rampaTexto: resumenRampa(d.ramp),
    bajadas: d.descents,
    porcentaje: d.reach.percent,
    // El tramo DECLARADO (o todo el eje): lo que el operador escribio.
    desde: tramo.from,
    hasta: tramo.to,
    ancho: Math.max(0, tramo.to - tramo.from),
    tramoDeclarado: tramo.declared,
    // El alcance REAL: el tramo recortado por el porcentaje efectivo.
    alcance: d.reach,
    segmentos: d.segments,
    segmentosDesconocidos: d.unknownSegments,
    ficha: d.meta,
    peso: typeof c?.weight === 'number' ? c.weight : 1,
    imagenes: Array.isArray(c?.images) ? c.images.length : 0,
    video: Boolean(c?.preRollVideo),
    botones: [
      c?.viewButton ? 'ver' : null,
      c?.closeButton ? 'cerrar' : null,
    ].filter(Boolean).join(' + ') || 'ninguno',
    color: color(i),
  };
}));

/** Encendidas: las que el operador ha activado (con o sin calendario). */
const activas = computed(() => filas.value.filter((f) => f.activa));

/**
 * Vivas AHORA: encendidas y dentro de su calendario. Solo estas pueden
 * llegar a verse hoy, asi que solo con estas se razona el conjunto: el
 * mapa miente si pinta apagadas, caducadas o aun no empezadas.
 */
const vivas = computed(() => filas.value.filter((f) => f.viva));

/**
 * Huecos del eje sin NINGUNA campaña viva.
 *
 * Es el aviso mas valioso del panel: un hueco no da error en ninguna
 * parte, simplemente hay gente que nunca ve publicidad, y eso solo se
 * descubre mirando el eje entero. Se calcula con el alcance REAL (tramo
 * recortado por el porcentaje), que es lo que el jugador experimenta.
 */
const huecos = computed(() => {
  const puntos = vivas.value
    .filter((f) => f.alcance.width > 0)
    .map((f) => ({ desde: f.alcance.from, hasta: f.alcance.to }))
    .sort((a, b) => a.desde - b.desde);
  const out = [];
  let cursor = 0;
  for (const p of puntos) {
    if (p.desde > cursor) out.push({ desde: cursor, hasta: p.desde });
    cursor = Math.max(cursor, p.hasta);
  }
  if (cursor < 100) out.push({ desde: cursor, hasta: 100 });
  return out;
});

/** Parejas de campañas vivas que comparten publico. */
const solapes = computed(() => {
  const out = [];
  for (let i = 0; i < vivas.value.length; i += 1) {
    for (let j = i + 1; j < vivas.value.length; j += 1) {
      const a = vivas.value[i];
      const b = vivas.value[j];
      const desde = Math.max(a.alcance.from, b.alcance.from);
      const hasta = Math.min(a.alcance.to, b.alcance.to);
      if (desde < hasta) out.push({ a, b, desde, hasta });
    }
  }
  return out;
});

/**
 * Campañas que NUNCA se veran: con la politica `order`, una campaña
 * cuyo alcance esta enteramente cubierto por otra anterior de la lista
 * es codigo muerto. El formulario no puede detectarlo (cada campo es
 * valido por separado); el conjunto si.
 */
const tapadas = computed(() => {
  if (politica.value !== 'order') return [];
  const out = [];
  vivas.value.forEach((f, pos) => {
    if (f.alcance.width <= 0) return;
    const previas = vivas.value.slice(0, pos);
    const cubierta = previas.some(
      (p) => p.alcance.from <= f.alcance.from && p.alcance.to >= f.alcance.to,
    );
    if (cubierta) out.push(f);
  });
  return out;
});

const total = computed(
  () => vivas.value.reduce((n, f) => n + (f.peso || 0), 0),
);

/**
 * Tramos VACIOS o invertidos: la campaña no la vera nadie.
 *
 * El juego los respeta a proposito (equivocarse hacia "nadie" es mas
 * barato que hacia "todo el parque"), asi que el aviso tiene que
 * estar aqui o el fallo seria mudo: una campaña configurada, guardada
 * y publicada que simplemente no aparece.
 */
const vacios = computed(
  () => filas.value.filter((f) => f.activa && f.tramoDeclarado && f.ancho <= 0),
);

/**
 * Tramo correcto pero FUERA del porcentaje: el porcentaje recorta el eje
 * desde el 0, asi que un tramo 50–100 con la rampa al 10 % no deja entrar
 * a nadie todavia. Cada campo es valido por separado; juntos, no llega a
 * nadie. Es la trampa mas silenciosa del sobre.
 */
const recortadas = computed(
  () => filas.value.filter(
    (f) => f.activa && f.ancho > 0 && f.alcance.width <= 0,
  ),
);

/**
 * Ids repetidos. El cooldown y el cierre por sesion se guardan POR id,
 * asi que dos campañas con el mismo se heredan las marcas y la segunda
 * puede no verse nunca. Se cuela con solo duplicar una campaña y
 * olvidar renombrarla, que es exactamente lo que invita a hacer un
 * formulario con boton de duplicar.
 */
const repetidos = computed(() => {
  const cuenta = new Map();
  for (const f of filas.value) {
    cuenta.set(f.id, (cuenta.get(f.id) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .filter(([, n]) => n > 1)
    .map(([id, n]) => ({ id, n }));
});

/** Encendidas pero con el calendario ya terminado: nadie las ve. */
const caducadas = computed(
  () => filas.value.filter(
    (f) => f.activa && f.estado.state === 'expired' && !f.estado.inverted,
  ),
);

/** Calendario con desde >= hasta: no estara activo NUNCA. */
const invertidas = computed(
  () => filas.value.filter((f) => f.estado.inverted),
);

/** Rampas con algun escalon que BAJA: un rollback programado. */
const rampasQueBajan = computed(
  () => filas.value
    .filter((f) => f.bajadas.length > 0)
    .map((f) => ({ fila: f, bajada: f.bajadas[0], n: f.bajadas.length })),
);

/** Segmentos que el juego no conoce: no entra nadie (fail-closed). */
const segmentosDesconocidos = computed(
  () => filas.value.filter((f) => f.segmentosDesconocidos.length > 0),
);

/** Ficha sin nombre o responsable: la auditoria no sabra de quien es. */
const sinFicha = computed(
  () => filas.value.filter((f) => f.ficha.gaps.length > 0),
);

/** Las que pasan del tope y por tanto NO llegan al juego. */
const sobrantes = computed(() => Math.max(0, filas.value.length - 20));

const hayAvisos = computed(() => (
  huecos.value.length || solapes.value.length || tapadas.value.length
  || vacios.value.length || recortadas.value.length || repetidos.value.length
  || sobrantes.value || caducadas.value.length || invertidas.value.length
  || rampasQueBajan.value.length || segmentosDesconocidos.value.length
  || sinFicha.value.length
));

function cambiarPolitica(valor) {
  emit('set', { path: 'ads.pick', value: valor });
}
</script>

<template>
  <!--
    Sin seccion `ads` y sin pausa no hay nada que enseñar: el marco vacio
    pareceria un panel roto.
  -->
  <section v-if="ads || pausadas" class="campanas">
    <!--
      La pausa global va ARRIBA DEL TODO y en rojo: con ella puesta, nada de
      lo que sigue llega a nadie, y quien abra el panel sin contexto podria
      pasarse una hora afinando tramos de campañas que estan paradas.
    -->
    <p v-if="pausadas" class="campanas__pausa">
      <strong>TODAS las campañas están en pausa</strong>
      (<code>ops.pauseCampaigns</code>). Ninguna campaña de ninguna sección
      llega a nadie hasta que se apague en la pestaña «Operación».
      <span v-if="motivoPausa" class="campanas__pausa-motivo">
        Motivo: «{{ motivoPausa }}»
      </span>
    </p>

    <template v-if="ads">
      <header class="campanas__cabecera">
        <h2>Campañas simultáneas</h2>
        <span class="campanas__conteo mono">
          {{ activas.length }} encendida(s) de {{ filas.length }} ·
          {{ vivas.length }} viva(s) ahora · máximo 20
        </span>
      </header>

      <div class="campanas__politica">
        <span class="campanas__etiqueta">Cuando varias aplican al mismo jugador</span>
        <div class="campanas__opciones">
          <button
            v-for="p in POLITICAS"
            :key="p.valor"
            type="button"
            class="campanas__opcion"
            :class="{ activa: politica === p.valor }"
            @click="cambiarPolitica(p.valor)"
          >
            {{ p.etiqueta }}
          </button>
        </div>
        <p class="campanas__ayuda">
          {{ POLITICAS.find((p) => p.valor === politica)?.resumen }}
        </p>
      </div>

      <!--
        Un CARRIL por campaña, no todas en la misma barra: cuando dos
        tramos se solapan —que es legitimo y hay que poder verlo— una
        sola barra las dibuja una encima de otra y no se entiende nada.
        Asi el solape se lee como lo que es: dos carriles que coinciden
        en la misma franja vertical.

        En cada carril van DOS barras: el tramo declarado (tenue) y el
        alcance real de hoy (solido). Cuando la rampa va por el 10 %, la
        diferencia entre las dos es exactamente lo que el operador quiere
        ver. Las encendidas que no estan vivas (programadas, caducadas)
        salen atenuadas y etiquetadas: existen, pero hoy no cubren a nadie.
      -->
      <div class="campanas__mapa">
        <div
          v-for="f in activas"
          :key="f.id + f.indice"
          class="campanas__carril"
          :class="{ inerte: !f.viva }"
        >
          <span class="campanas__carril-nombre">
            {{ f.id }}
            <span v-if="!f.viva" class="campanas__carril-estado">
              ({{ f.estado.label }})
            </span>
          </span>
          <span class="campanas__carril-pista">
            <span
              v-if="f.tramoDeclarado || f.alcance.width < f.ancho"
              class="campanas__tramo campanas__tramo--declarado"
              :style="{
                left: f.desde + '%',
                width: f.ancho + '%',
                borderColor: f.color,
              }"
              :title="`${f.id}: tramo ${f.desde}–${f.hasta} %`"
            />
            <span
              class="campanas__tramo"
              :style="{
                left: f.alcance.from + '%',
                width: f.alcance.width + '%',
                background: f.color,
              }"
              :title="`${f.id}: llega hoy a ${f.alcance.from}–${f.alcance.to} % (porcentaje efectivo ${f.porcentaje} %)`"
            />
          </span>
          <span class="campanas__carril-cifra mono">
            {{ f.alcance.from }}–{{ f.alcance.to }}
          </span>
        </div>
        <div class="campanas__carril">
          <span class="campanas__carril-nombre" />
          <span class="campanas__regla mono">
            <span>0 %</span><span>50 %</span><span>100 % del parque</span>
          </span>
          <span class="campanas__carril-cifra" />
        </div>
      </div>

      <ul v-if="hayAvisos" class="campanas__avisos">
        <li v-if="sobrantes" class="aviso malo">
          Hay <strong>{{ filas.length }} campañas</strong> y el juego solo
          lee las <strong>20 primeras</strong>: las {{ sobrantes }} últimas
          no llegan al dispositivo.
        </li>
        <li v-for="v in vacios" :key="'v' + v.indice" class="aviso malo">
          <strong>{{ v.id }}</strong> tiene un tramo vacío
          ({{ v.desde }}–{{ v.hasta }}): no la verá nadie. Si querías todo
          el parque, borra el tramo en vez de dejarlo a cero.
        </li>
        <li v-for="r in recortadas" :key="'rc' + r.indice" class="aviso malo">
          <strong>{{ r.id }}</strong> tiene el tramo {{ r.desde }}–{{ r.hasta }}
          pero su porcentaje efectivo es {{ r.porcentaje }} %, y el porcentaje
          recorta el eje desde el 0: ahora mismo no entra nadie. Sube el
          porcentaje (o espera a la rampa) por encima de {{ r.desde }}, o
          mueve el tramo.
        </li>
        <li v-for="r in repetidos" :key="'r' + r.id" class="aviso malo">
          El id <strong>{{ r.id }}</strong> se repite {{ r.n }} veces. El
          cooldown y el cierre por sesión se guardan por id: la segunda
          heredaría las marcas de la primera y puede no verse nunca.
        </li>
        <li v-for="c in caducadas" :key="'c' + c.indice" class="aviso malo">
          <strong>{{ c.id }}</strong> está encendida pero su calendario
          terminó el {{ fecha(c.estado.to) }}: no la ve nadie. Apágala, o
          quítale la fecha de fin si tiene que seguir.
        </li>
        <li v-for="i in invertidas" :key="'i' + i.indice" class="aviso malo">
          <strong>{{ i.id }}</strong> tiene el calendario invertido («desde»
          {{ fecha(i.estado.from) }} es posterior a «hasta»
          {{ fecha(i.estado.to) }}): no estará activa nunca.
        </li>
        <li v-for="b in rampasQueBajan" :key="'b' + b.fila.indice" class="aviso malo">
          La rampa de <strong>{{ b.fila.id }}</strong> BAJA de
          {{ b.bajada.from }} % a {{ b.bajada.to }} % el
          {{ fecha(b.bajada.at) }}<span v-if="b.n > 1"> (y {{ b.n - 1 }} más)</span>.
          Una rampa existe para subir sin publicar en cada paso; un escalón
          que baja es un rollback programado que quita la campaña a gente
          que ya la tenía.
        </li>
        <li v-for="s in segmentosDesconocidos" :key="'sd' + s.indice" class="aviso malo">
          <strong>{{ s.id }}</strong> exige el segmento
          <code>{{ s.segmentosDesconocidos.join(', ') }}</code>, que este
          juego no conoce: no entrará nadie. Los que existen son
          <code>{{ (vocabulario.segments ?? []).join(', ') }}</code>.
        </li>
        <li v-for="(h, i) in huecos" :key="'h' + i" class="aviso">
          <strong>{{ (h.hasta - h.desde).toFixed(0) }} % del parque</strong>
          ({{ h.desde }}–{{ h.hasta }}) no tiene ninguna campaña viva ahora:
          esa gente no verá publicidad.
        </li>
        <li v-for="(s, i) in solapes" :key="'s' + i" class="aviso">
          <strong>{{ s.a.id }}</strong> y <strong>{{ s.b.id }}</strong>
          comparten el público {{ s.desde }}–{{ s.hasta }} %. Ahí decide el
          reparto de arriba, no el tramo.
        </li>
        <li v-for="(t, i) in tapadas" :key="'t' + i" class="aviso malo">
          <strong>{{ t.id }}</strong> no se verá nunca: con el reparto por
          «orden», otra campaña anterior cubre todo su alcance.
        </li>
        <li v-for="f in sinFicha" :key="'f' + f.indice" class="aviso suave">
          <strong>{{ f.id }}</strong> no tiene
          {{ f.ficha.gaps.map((g) => (g === 'name' ? 'nombre' : 'responsable')).join(' ni ') }}
          en la ficha: dentro de seis meses nadie sabrá de quién es, y la
          auditoría (<code>pnpm remote-config:audit</code>) no podrá avisar.
        </li>
      </ul>

      <table class="campanas__tabla">
        <thead>
          <tr>
            <th>#</th><th>Campaña</th><th>Cuándo</th><th>Público ahora</th>
            <th>Segmentos</th><th>Peso</th><th>Imágenes</th><th>Vídeo</th>
            <th>Botones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in filas" :key="f.indice" :class="{ apagada: !f.activa }">
            <td class="mono">
              <span class="campanas__punto" :style="{ background: f.color }" />
              {{ f.indice + 1 }}
            </td>
            <td>
              <div class="campanas__nombre">
                {{ f.id }}
                <span v-if="!f.activa" class="campanas__chip">apagada</span>
                <span
                  v-else-if="f.estado.state === 'scheduled'"
                  class="campanas__chip aviso-chip"
                >programada</span>
                <span
                  v-else-if="f.estado.state === 'expired'"
                  class="campanas__chip malo"
                >caducada</span>
                <span v-if="f.imagenes === 0" class="campanas__chip malo">
                  sin imagen
                </span>
              </div>
              <div class="campanas__ficha">
                <span v-if="f.ficha.name">{{ f.ficha.name }}</span>
                <span v-else class="falta">sin nombre</span>
                ·
                <span v-if="f.ficha.owner">{{ f.ficha.owner }}</span>
                <span v-else class="falta">sin responsable</span>
              </div>
            </td>
            <td>
              <div class="campanas__estado" :class="f.estado.state">
                {{ f.estado.label }}
              </div>
              <div class="campanas__detalle">{{ f.calendario }}</div>
            </td>
            <td>
              <div class="mono">
                {{ f.alcance.from }}–{{ f.alcance.to }} %
                <span class="tenue">
                  · tramo {{ f.tramoDeclarado ? `${f.desde}–${f.hasta}` : 'todo el eje' }}
                  · {{ f.porcentaje }} %<template v-if="f.rampa.hasRamp && f.porcentaje !== f.rampa.base"> (base {{ f.rampa.base }} %)</template>
                </span>
              </div>
              <div class="campanas__detalle">rampa: {{ f.rampaTexto }}</div>
            </td>
            <td>
              <span v-if="f.segmentos.length === 0" class="tenue">todos</span>
              <span
                v-for="s in f.segmentos"
                :key="s"
                class="campanas__chip"
                :class="{ malo: f.segmentosDesconocidos.includes(s) }"
              >{{ s }}</span>
            </td>
            <td class="mono">
              {{ f.peso }}
              <span v-if="politica !== 'order' && total > 0 && f.viva" class="tenue">
                ({{ Math.round((f.peso / total) * 100) }} %)
              </span>
            </td>
            <td class="mono">{{ f.imagenes }}</td>
            <td>{{ f.video ? 'sí' : '—' }}</td>
            <td>{{ f.botones }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.campanas {
  border: 1px solid var(--borde, #d5d9e0);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 20px;
  background: var(--panel, #fff);
}
.campanas__pausa {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--error, #b3261e);
  border-radius: var(--radio, 6px);
  background: #3a1418;
  color: #ffb4b0;
  font-size: 0.92rem;
}
.campanas__pausa-motivo { display: block; margin-top: 4px; opacity: 0.85; }
.campanas__cabecera {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.campanas__cabecera h2 { font-size: 1.05rem; margin: 0; }
.campanas__conteo { opacity: 0.6; font-size: 0.85rem; }
.campanas__politica { margin-bottom: 14px; }
.campanas__etiqueta { font-size: 0.85rem; opacity: 0.75; }
.campanas__opciones { display: flex; gap: 8px; margin: 6px 0; flex-wrap: wrap; }
.campanas__opcion {
  padding: 6px 12px;
  border: 1px solid var(--borde, #d5d9e0);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
.campanas__opcion.activa {
  background: #4f8cff;
  border-color: #4f8cff;
  color: #fff;
}
.campanas__ayuda { margin: 0; font-size: 0.85rem; opacity: 0.75; }
.campanas__mapa { margin-bottom: 14px; }
.campanas__carril {
  display: grid;
  grid-template-columns: minmax(90px, 170px) 1fr 64px;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.campanas__carril.inerte { opacity: 0.4; }
.campanas__carril-nombre {
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}
.campanas__carril-estado { font-style: italic; opacity: 0.8; }
.campanas__carril-pista {
  position: relative;
  display: block;
  height: 14px;
  border-radius: 4px;
  /* El rayado es parque SIN cubrir: lo que asome es un hueco. */
  background: repeating-linear-gradient(
    45deg,
    rgb(127 127 127 / 12%),
    rgb(127 127 127 / 12%) 5px,
    rgb(127 127 127 / 22%) 5px,
    rgb(127 127 127 / 22%) 10px
  );
}
.campanas__tramo {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 4px;
  opacity: 0.9;
}
/* El tramo declarado, solo contorno: lo que NO esta solido es lo que la
   rampa todavia no deja entrar. */
.campanas__tramo--declarado {
  background: transparent;
  border: 1px dashed;
  opacity: 0.6;
  box-sizing: border-box;
}
.campanas__carril-cifra {
  font-size: 0.72rem;
  opacity: 0.6;
  text-align: right;
}
.campanas__regla {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  opacity: 0.5;
}
.campanas__avisos { margin: 0 0 14px; padding-left: 18px; font-size: 0.88rem; }
.campanas__avisos .aviso { margin-bottom: 4px; }
.campanas__avisos .malo { color: var(--error, #b3261e); }
.campanas__avisos .suave { opacity: 0.7; }
.campanas__tabla { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.campanas__tabla th {
  text-align: left;
  font-weight: 600;
  opacity: 0.7;
  border-bottom: 1px solid var(--borde, #d5d9e0);
  padding: 4px 6px;
}
.campanas__tabla td {
  padding: 6px 6px;
  border-bottom: 1px solid var(--borde-suave, #eef1f5);
  vertical-align: top;
}
.campanas__tabla tr.apagada { opacity: 0.45; }
.campanas__nombre { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.campanas__ficha { font-size: 0.78rem; opacity: 0.7; margin-top: 2px; }
.campanas__ficha .falta { font-style: italic; opacity: 0.7; }
.campanas__estado { font-weight: 600; text-transform: capitalize; }
.campanas__estado.active { color: var(--ok, #3fb950); }
.campanas__estado.scheduled { color: var(--aviso, #d29922); }
.campanas__estado.expired { color: var(--error, #b3261e); }
.campanas__detalle { font-size: 0.76rem; opacity: 0.7; margin-top: 2px; }
.campanas__punto {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.campanas__chip {
  font-size: 0.72rem;
  border: 1px solid var(--borde, #d5d9e0);
  border-radius: 999px;
  padding: 1px 7px;
  margin-left: 4px;
  opacity: 0.85;
  white-space: nowrap;
}
.campanas__chip.malo { color: var(--error, #b3261e); border-color: var(--error, #f0b4ae); }
.campanas__chip.aviso-chip { color: var(--aviso, #d29922); border-color: var(--aviso, #d29922); }
</style>
