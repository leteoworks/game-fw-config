<script setup>
import { computed, ref } from 'vue';

/**
 * Editor de mapas por idioma: `{ en: 'Play', es: 'Jugar' }`.
 *
 * Se usa en las etiquetas de los botones del anuncio y en `urlByLocale`.
 *
 * ⚠️ El juego resuelve estos mapas en cascada **idioma exacto → idioma base
 * → `en`**, asi que el fallback real es `en`: un mapa sin `en` deja sin texto
 * a todo idioma que no este listado. Por eso `en` sale siempre el primero,
 * marcado como fallback, y se avisa si falta.
 */

const props = defineProps({
  modelValue: { type: [Object, null], default: undefined },
  placeholder: { type: String, default: '' },
  /**
   * Los idiomas del juego (`x-locales` del schema: `[{ code, title }]`),
   * para ofrecerlos de un clic. Vienen generados de la lista del framework,
   * así que aquí no hay que mantener ninguna.
   */
  suggested: { type: Array, default: null },
});
const emit = defineEmits(['update:modelValue']);

/** Reserva para un schema viejo que no traiga `x-locales`. */
const SUGERIDOS = ['en', 'es', 'pt-BR', 'fr', 'de', 'it', 'ja', 'ko', 'zh'];

const mapa = computed(() => props.modelValue ?? {});

/** `en` primero (es el fallback); el resto alfabetico. */
const entradas = computed(() => {
  const claves = Object.keys(mapa.value);
  return claves.sort((a, b) => {
    if (a === 'en') return -1;
    if (b === 'en') return 1;
    return a.localeCompare(b);
  }).map((k) => [k, mapa.value[k]]);
});

const faltaFallback = computed(
  () => entradas.value.length > 0 && !('en' in mapa.value),
);

const sugeridos = computed(() => (
  Array.isArray(props.suggested) && props.suggested.length > 0
    ? props.suggested.map((l) => ({ code: String(l.code), title: l.title ?? '' }))
    : SUGERIDOS.map((code) => ({ code, title: '' }))
));

const disponibles = computed(() => {
  const presentes = new Set(Object.keys(mapa.value).map((k) => k.toLowerCase()));
  return sugeridos.value.filter((l) => !presentes.has(l.code.toLowerCase()));
});

const nuevoIdioma = ref('');

function fijar(siguiente) {
  emit('update:modelValue', siguiente);
}

function poner(idioma, valor) {
  fijar({ ...mapa.value, [idioma]: valor });
}

function quitar(idioma) {
  const copia = { ...mapa.value };
  delete copia[idioma];
  fijar(copia);
}

function anadir(idioma) {
  const codigo = (idioma ?? nuevoIdioma.value).trim();
  if (!codigo || codigo in mapa.value) return;
  poner(codigo, '');
  nuevoIdioma.value = '';
}
</script>

<template>
  <div class="mapa">
    <div v-for="[idioma, valor] in entradas" :key="idioma" class="fila">
      <span class="idioma mono" :class="{ fallback: idioma === 'en' }">
        {{ idioma }}
        <em v-if="idioma === 'en'" title="Idioma al que cae todo lo demás">
          fallback
        </em>
      </span>
      <input
        type="text"
        :value="valor"
        :placeholder="placeholder"
        @input="poner(idioma, $event.target.value)"
      >
      <button
        type="button"
        class="quitar"
        :title="`Quitar ${idioma}`"
        @click="quitar(idioma)"
      >×</button>
    </div>

    <p v-if="entradas.length === 0" class="debil vacio">
      Sin traducciones.
    </p>

    <p v-if="faltaFallback" class="aviso">
      ⚠️ Falta <code>en</code>. Es el idioma al que cae la cascada, así que
      cualquier idioma no listado se quedará <strong>sin texto</strong>.
    </p>

    <div class="anadir">
      <button
        v-for="l in disponibles"
        :key="l.code"
        type="button"
        class="sugerido"
        :title="l.title"
        @click="anadir(l.code)"
      >+ {{ l.code }}</button>
      <input
        v-model="nuevoIdioma"
        type="text"
        class="codigo"
        placeholder="otro (pt-BR)"
        @keydown.enter.prevent="anadir()"
      >
    </div>
  </div>
</template>

<style scoped>
.fila { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.idioma {
  flex: 0 0 108px;
  display: inline-flex; align-items: center; gap: 5px;
  color: var(--texto-tenue);
}
.idioma.fallback { color: var(--acento); }
.idioma em { font-size: 10px; font-style: normal; opacity: .75; }

.quitar { border: none; background: none; color: var(--texto-debil); padding: 0 6px; }
.quitar:hover { color: var(--error); }

.vacio { margin: 0 0 8px; font-size: 12px; }

.anadir { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sugerido { font-size: 12px; padding: 3px 8px; }
.codigo { width: 130px; font-size: 12px; padding: 4px 8px; }

.aviso { margin: 4px 0 8px; font-size: 12px; color: var(--aviso); }
</style>
