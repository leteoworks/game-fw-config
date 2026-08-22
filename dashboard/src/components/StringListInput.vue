<script setup>
import { computed, ref } from 'vue';

import { invalidByPattern, patternHint } from '../lib/schema-form.mjs';

/**
 * Editor de listas de strings (etiquetas).
 *
 * Se usa para `platforms`, `locales`, `triggers` y —el importante— la
 * **allowlist de eventos de analitica**.
 *
 * ⚠️ Esa allowlist merece cuidado especial: por ADR-030 es UNA por juego, y
 * un evento que no este en la lista **se descarta en silencio** (no hay
 * error, el dashboard de analitica simplemente sale plano semanas despues).
 * Por eso aqui hay: buscador, contador, aviso de duplicados y un pegado
 * masivo — anadir veinte eventos a mano es justo donde se cuela el typo que
 * nadie ve.
 *
 * Cuando el schema declara un `enum` para los elementos (p.ej. `platforms`),
 * se ofrecen como casillas en vez de texto libre: no se puede escribir un
 * valor que el validador vaya a rechazar.
 *
 * Y cuando ademas son SEGMENTOS del juego (`x-segments`: nombre, titulo y
 * que significa cumplirlo), cada casilla lleva debajo su explicacion y la
 * lista termina con la regla que de verdad importa: el jugador tiene que
 * cumplir TODOS los marcados, y vacio es «sin restriccion» (no «nadie»).
 * Marcar «nuevos» y «veteranos» a la vez no suma publicos, los cruza — y
 * esos dos no se cruzan nunca.
 *
 * Cuando los elementos llevan un `pattern` (los idiomas y paises del sobre,
 * ADR-041: `^[a-z]{2,3}(-…)*$` y `^[A-Z]{2}$`) no hay enum que ofrecer como
 * casillas (son 250 paises), asi que el formato se dice DEBAJO de la lista
 * en cristiano y lo que no lo cumple sale en ROJO antes de guardar, con la
 * misma expresion que usa el validador (`new RegExp(pattern)`). Importa
 * porque el fallo seria mudo en el juego: el pais que pone el servidor es
 * siempre `ES`, y un `es` escrito a mano no casaria con nadie nunca. No se
 * corrige solo (nada de transformaciones silenciosas): se marca, y quien
 * edita decide.
 */

const props = defineProps({
  modelValue: { type: [Array, null], default: undefined },
  itemsSchema: { type: Object, default: null },
  nullable: { type: Boolean, default: false },
  placeholder: { type: String, default: 'añadir…' },
  /** Segmentos nombrados ({ name, title, description }) o null. */
  segments: { type: Array, default: null },
});
const emit = defineEmits(['update:modelValue']);

const lista = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
const opciones = computed(() => props.itemsSchema?.enum ?? null);

/** Patron de los elementos (idiomas, paises), si el schema lo trae. */
const patron = computed(() => (
  typeof props.itemsSchema?.pattern === 'string' ? props.itemsSchema.pattern : null
));
const pista = computed(() => patternHint(patron.value));
/** Valores que el validador rechazara: se marcan, no se corrigen. */
const invalidos = computed(() => new Set(invalidByPattern(lista.value, patron.value)));

/** Titulo y explicacion de una opcion, si es un segmento conocido. */
const detalleDe = (op) => props.segments?.find((s) => s?.name === op) ?? null;

const nuevo = ref('');
const filtro = ref('');
const pegando = ref(false);
const textoPegado = ref('');

const visibles = computed(() => {
  const f = filtro.value.trim().toLowerCase();
  return lista.value
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => !f || String(v).toLowerCase().includes(f));
});

/** Valores repetidos: el validador no los rechaza pero no aportan nada. */
const duplicados = computed(() => {
  const vistos = new Set();
  const repes = new Set();
  for (const v of lista.value) {
    if (vistos.has(v)) repes.add(v);
    vistos.add(v);
  }
  return repes;
});

function fijar(siguiente) {
  emit('update:modelValue', siguiente);
}

function anadir(valor) {
  const v = String(valor ?? nuevo.value).trim();
  if (!v) return;
  if (lista.value.includes(v)) { nuevo.value = ''; return; }
  fijar([...lista.value, v]);
  nuevo.value = '';
}

function quitar(indice) {
  fijar(lista.value.filter((_, i) => i !== indice));
}

function alternar(opcion) {
  if (lista.value.includes(opcion)) fijar(lista.value.filter((v) => v !== opcion));
  else fijar([...lista.value, opcion]);
}

/** Pegado masivo: admite saltos de linea, comas y espacios como separador. */
function aplicarPegado() {
  const trozos = textoPegado.value
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^["']|["'],?$/g, ''))
    .filter(Boolean);
  const union = [...new Set([...lista.value, ...trozos])];
  fijar(union);
  textoPegado.value = '';
  pegando.value = false;
}
</script>

<template>
  <div class="lista">
    <!-- Conjunto cerrado: casillas, no texto libre. -->
    <div v-if="opciones" class="cerrado">
      <div class="opciones" :class="{ detallada: segments }">
        <label v-for="op in opciones" :key="op" class="opcion">
          <input
            type="checkbox"
            :checked="lista.includes(op)"
            @change="alternar(op)"
          >
          <span v-if="detalleDe(op)" class="opcion-detalle">
            <span class="opcion-titulo">
              {{ detalleDe(op).title }}
              <code class="opcion-nombre">{{ op }}</code>
            </span>
            <span class="opcion-descripcion">{{ detalleDe(op).description }}</span>
          </span>
          <span v-else>{{ op }}</span>
        </label>
      </div>
      <p v-if="segments" class="nota-segmentos">
        El jugador tiene que cumplir <strong>TODOS</strong> los marcados.
        Vacío = sin restricción.
      </p>
    </div>

    <template v-else>
      <div class="cabecera">
        <span class="contador mono">{{ lista.length }} elemento(s)</span>
        <input
          v-if="lista.length > 8"
          v-model="filtro"
          type="text"
          class="filtro"
          placeholder="filtrar…"
        >
        <button type="button" @click="pegando = !pegando">
          {{ pegando ? 'cancelar' : 'pegar lista' }}
        </button>
      </div>

      <div v-if="pegando" class="pegado">
        <textarea
          v-model="textoPegado"
          rows="4"
          placeholder="Pega aquí varios valores separados por comas, espacios o saltos de línea"
        />
        <button type="button" class="primario" @click="aplicarPegado">
          Añadir {{ textoPegado.split(/[\s,;]+/).filter(Boolean).length }}
        </button>
      </div>

      <ul class="etiquetas">
        <li
          v-for="{ v, i } in visibles"
          :key="`${v}-${i}`"
          :class="{ duplicado: duplicados.has(v), invalido: invalidos.has(v) }"
          :title="invalidos.has(v) ? `«${v}» no cumple el formato: ${pista}` : undefined"
        >
          <span class="mono">{{ v }}</span>
          <button
            type="button"
            class="quitar"
            :title="`Quitar ${v}`"
            @click="quitar(i)"
          >×</button>
        </li>
        <li v-if="visibles.length === 0" class="vacio debil">
          {{ filtro ? 'nada coincide con el filtro' : 'lista vacía' }}
        </li>
      </ul>

      <div class="anadir">
        <input
          v-model="nuevo"
          type="text"
          :placeholder="placeholder"
          @keydown.enter.prevent="anadir()"
        >
        <button type="button" @click="anadir()">Añadir</button>
      </div>

      <p v-if="pista" class="pista">
        Formato: {{ pista }}.
      </p>

      <p v-if="invalidos.size" class="aviso malo">
        ⚠️ No cumplen el formato:
        <code>{{ [...invalidos].join(', ') }}</code>. El validador los
        rechazará al guardar; corrígelos aquí (no se corrigen solos).
      </p>

      <p v-if="duplicados.size" class="aviso">
        ⚠️ Hay valores repetidos ({{ [...duplicados].join(', ') }}). No dan
        error, pero tampoco hacen nada.
      </p>
    </template>

    <label v-if="nullable" class="nulo">
      <input
        type="checkbox"
        :checked="modelValue === null"
        @change="fijar($event.target.checked ? null : [])"
      >
      <span>
        <code>null</code> — sin lista (⚠️ distinto de lista vacía)
      </span>
    </label>
  </div>
</template>

<style scoped>
.cabecera { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.contador { color: var(--texto-tenue); flex: 0 0 auto; }
.filtro { flex: 1 1 auto; }
.cabecera button { flex: 0 0 auto; font-size: 12px; padding: 4px 8px; }

.pegado { margin-bottom: 8px; display: grid; gap: 6px; }

.etiquetas {
  list-style: none; margin: 0 0 8px; padding: 0;
  display: flex; flex-wrap: wrap; gap: 6px;
  max-height: 260px; overflow-y: auto;
}
.etiquetas li {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--panel-alto);
  border: 1px solid var(--borde);
  border-radius: 999px;
  padding: 3px 6px 3px 10px;
}
.etiquetas li.duplicado { border-color: var(--aviso); }
/* Lo que el validador va a rechazar, en rojo ANTES de pulsar Guardar. */
.etiquetas li.invalido { border-color: var(--error); }
.etiquetas li.invalido .mono { color: var(--error); }
.etiquetas li.vacio { background: none; border: none; padding: 2px 0; }

.quitar {
  border: none; background: none; padding: 0 4px;
  color: var(--texto-debil); line-height: 1;
}
.quitar:hover { color: var(--error); }

.anadir { display: flex; gap: 6px; }

.opciones { display: flex; flex-wrap: wrap; gap: 12px; }
.opcion { display: inline-flex; align-items: center; gap: 6px; }
.opcion input { width: auto; }

/* Segmentos: uno por linea, con su explicacion debajo del titulo. */
.opciones.detallada { flex-direction: column; gap: 8px; }
.opciones.detallada .opcion { align-items: flex-start; gap: 9px; }
.opciones.detallada .opcion input { margin-top: 4px; }
.opcion-detalle { display: flex; flex-direction: column; gap: 1px; }
.opcion-titulo { display: flex; align-items: baseline; gap: 8px; font-weight: 600; }
.opcion-nombre { font-size: 11px; color: var(--texto-debil); font-weight: 400; }
.opcion-descripcion {
  font-size: 12px; line-height: 1.45; color: var(--texto-tenue);
  max-width: 72ch;
}
.nota-segmentos {
  margin: 10px 0 0; padding: 6px 10px;
  border-left: 2px solid var(--acento);
  background: var(--panel-alto);
  border-radius: 0 var(--radio) var(--radio) 0;
  font-size: 12px; color: var(--texto-tenue);
}
.nota-segmentos strong { color: var(--texto); }

.nulo {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; font-size: 12px; color: var(--texto-tenue);
}
.nulo input { width: auto; }

.aviso { margin: 4px 0 0; font-size: 12px; color: var(--aviso); }
.aviso.malo { color: var(--error); }
.aviso.malo code { color: inherit; }
.pista { margin: 6px 0 0; font-size: 12px; color: var(--texto-tenue); }
</style>
