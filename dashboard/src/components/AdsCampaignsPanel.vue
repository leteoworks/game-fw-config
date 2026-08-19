<script setup>
import { computed } from 'vue';

/**
 * Mapa de CAMPAÑAS de publicidad.
 *
 * ## Por que existe, si el formulario ya edita todos los campos
 *
 * El formulario generado del schema es exacto pero no da la vista de
 * conjunto, y con hasta 20 campañas simultaneas la pregunta operativa
 * no es "que dice el campo `toPercent` de la campaña 7" sino "¿queda
 * gente sin ningun anuncio?" y "¿hay dos campañas peleandose por el
 * mismo publico?". Eso no se ve leyendo una lista de formularios: se ve
 * en un dibujo del eje del parque.
 *
 * Por eso este panel es de LECTURA (salvo la politica de reparto, que
 * es una decision de una sola linea): el detalle se sigue editando en
 * el formulario de abajo, y aqui se comprueba que el conjunto tiene
 * sentido antes de publicar.
 */

const props = defineProps({
  /** El JSON completo en edicion. */
  datos: { type: Object, required: true },
});

const emit = defineEmits(['set']);

const ads = computed(() => props.datos?.ads ?? null);
const campanas = computed(() => ads.value?.banners ?? []);
const politica = computed(() => ads.value?.pick ?? 'order');

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

/** Tramo efectivo de una campaña (sin tramo declarado = todo el parque). */
function tramo(campana) {
  const a = campana?.audience;
  if (!a || typeof a.fromPercent !== 'number') return { desde: 0, hasta: 100 };
  return { desde: a.fromPercent, hasta: a.toPercent };
}

/** Color estable por posicion, para que el mapa y la lista concuerden. */
const COLORES = [
  '#4f8cff', '#ff9f6e', '#7ee081', '#c9a7ff', '#ffd54a',
  '#5ad2d2', '#ff8fa3', '#a0d468', '#f4a261', '#9aa5b1',
];
const color = (i) => COLORES[i % COLORES.length];

const filas = computed(() => campanas.value.map((c, i) => {
  const t = tramo(c);
  return {
    indice: i,
    id: c?.id ?? '(sin id)',
    activa: c?.enabled === true,
    desde: t.desde,
    hasta: t.hasta,
    ancho: Math.max(0, t.hasta - t.desde),
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

/** Solo las que pueden llegar a verse: el mapa miente si pinta apagadas. */
const activas = computed(() => filas.value.filter((f) => f.activa));

/**
 * Huecos del eje sin NINGUNA campaña activa.
 *
 * Es el aviso mas valioso del panel: un hueco no da error en ninguna
 * parte, simplemente hay gente que nunca ve publicidad, y eso solo se
 * descubre mirando el eje entero.
 */
const huecos = computed(() => {
  const puntos = activas.value
    .map((f) => ({ desde: f.desde, hasta: f.hasta }))
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

/** Parejas de campañas activas que comparten publico. */
const solapes = computed(() => {
  const out = [];
  for (let i = 0; i < activas.value.length; i += 1) {
    for (let j = i + 1; j < activas.value.length; j += 1) {
      const a = activas.value[i];
      const b = activas.value[j];
      const desde = Math.max(a.desde, b.desde);
      const hasta = Math.min(a.hasta, b.hasta);
      if (desde < hasta) out.push({ a, b, desde, hasta });
    }
  }
  return out;
});

/**
 * Campañas que NUNCA se veran: con la politica `order`, una campaña
 * cuyo tramo esta enteramente cubierto por otra anterior de la lista
 * es codigo muerto. El formulario no puede detectarlo (cada campo es
 * valido por separado); el conjunto si.
 */
const tapadas = computed(() => {
  if (politica.value !== 'order') return [];
  const out = [];
  activas.value.forEach((f, pos) => {
    const previas = activas.value.slice(0, pos);
    const cubierta = previas.some(
      (p) => p.desde <= f.desde && p.hasta >= f.hasta,
    );
    if (cubierta) out.push(f);
  });
  return out;
});

const total = computed(
  () => activas.value.reduce((n, f) => n + (f.peso || 0), 0),
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
  () => filas.value.filter((f) => f.activa && f.ancho <= 0),
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

/** Las que pasan del tope y por tanto NO llegan al juego. */
const sobrantes = computed(() => Math.max(0, filas.value.length - 20));

function cambiarPolitica(valor) {
  emit('set', { path: 'ads.pick', value: valor });
}
</script>

<template>
  <section v-if="ads" class="campanas">
    <header class="campanas__cabecera">
      <h2>Campañas simultáneas</h2>
      <span class="campanas__conteo mono">
        {{ activas.length }} activa(s) de {{ filas.length }} · máximo 20
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
    -->
    <div class="campanas__mapa">
      <div
        v-for="f in activas"
        :key="f.id + f.indice"
        class="campanas__carril"
      >
        <span class="campanas__carril-nombre">{{ f.id }}</span>
        <span class="campanas__carril-pista">
          <span
            class="campanas__tramo"
            :style="{
              left: f.desde + '%',
              width: f.ancho + '%',
              background: f.color,
            }"
            :title="`${f.id}: ${f.desde}% - ${f.hasta}%`"
          />
        </span>
        <span class="campanas__carril-cifra mono">
          {{ f.desde }}–{{ f.hasta }}
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

    <ul v-if="huecos.length || solapes.length || tapadas.length
              || vacios.length || repetidos.length || sobrantes"
        class="campanas__avisos">
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
      <li v-for="r in repetidos" :key="'r' + r.id" class="aviso malo">
        El id <strong>{{ r.id }}</strong> se repite {{ r.n }} veces. El
        cooldown y el cierre por sesión se guardan por id: la segunda
        heredaría las marcas de la primera y puede no verse nunca.
      </li>
      <li v-for="(h, i) in huecos" :key="'h' + i" class="aviso">
        <strong>{{ (h.hasta - h.desde).toFixed(0) }} % del parque</strong>
        ({{ h.desde }}–{{ h.hasta }}) no tiene ninguna campaña activa: esa
        gente no verá publicidad.
      </li>
      <li v-for="(s, i) in solapes" :key="'s' + i" class="aviso">
        <strong>{{ s.a.id }}</strong> y <strong>{{ s.b.id }}</strong>
        comparten el público {{ s.desde }}–{{ s.hasta }} %. Ahí decide el
        reparto de arriba, no el tramo.
      </li>
      <li v-for="(t, i) in tapadas" :key="'t' + i" class="aviso malo">
        <strong>{{ t.id }}</strong> no se verá nunca: con el reparto por
        «orden», otra campaña anterior cubre todo su tramo.
      </li>
    </ul>

    <table class="campanas__tabla">
      <thead>
        <tr>
          <th>#</th><th>Campaña</th><th>Tramo</th><th>Peso</th>
          <th>Imágenes</th><th>Vídeo</th><th>Botones</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="f in filas" :key="f.indice" :class="{ apagada: !f.activa }">
          <td class="mono">
            <span class="campanas__punto" :style="{ background: f.color }" />
            {{ f.indice + 1 }}
          </td>
          <td>
            {{ f.id }}
            <span v-if="!f.activa" class="campanas__chip">apagada</span>
            <span v-if="f.imagenes === 0" class="campanas__chip malo">
              sin imagen
            </span>
          </td>
          <td class="mono">{{ f.desde }}–{{ f.hasta }} %</td>
          <td class="mono">
            {{ f.peso }}
            <span v-if="politica !== 'order' && total > 0" class="tenue">
              ({{ Math.round((f.peso / total) * 100) }} %)
            </span>
          </td>
          <td class="mono">{{ f.imagenes }}</td>
          <td>{{ f.video ? 'sí' : '—' }}</td>
          <td>{{ f.botones }}</td>
        </tr>
      </tbody>
    </table>
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
.campanas__carril-nombre {
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}
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
.campanas__avisos .malo { color: #b3261e; }
.campanas__tabla { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.campanas__tabla th {
  text-align: left;
  font-weight: 600;
  opacity: 0.7;
  border-bottom: 1px solid var(--borde, #d5d9e0);
  padding: 4px 6px;
}
.campanas__tabla td { padding: 5px 6px; border-bottom: 1px solid #eef1f5; }
.campanas__tabla tr.apagada { opacity: 0.45; }
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
  margin-left: 6px;
  opacity: 0.75;
}
.campanas__chip.malo { color: #b3261e; border-color: #f0b4ae; }
</style>
