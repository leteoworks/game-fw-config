<script setup>
import { computed, ref } from 'vue';

import { api } from '../api.mjs';

/**
 * Campo de creatividad: sube el archivo y escribe su URL, con vista previa.
 *
 * ⚠️ El motivo de que esto NO sea un campo de texto: la URL de una imagen es
 * el sitio donde un fallo se vuelve invisible. Si apunta a un host que el CSP
 * no permite, el navegador la bloquea y **el juego no da ningun error** — el
 * anuncio sale en blanco y parece un fallo del modulo de ads. Y si apunta a
 * una ruta que no existe, el sintoma es exactamente el mismo.
 *
 * Aqui las dos cosas se ven antes de publicar: al subir, la URL la construye
 * el servidor con el host bueno; y la vista previa carga la URL de verdad,
 * asi que una imagen rota se ve rota.
 */

const props = defineProps({
  modelValue: { type: String, default: undefined },
  kind: { type: String, default: 'image' },   // 'image' | 'video'
  gameId: { type: String, required: true },
  assets: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue', 'assets-changed']);

const subiendo = ref(false);
const error = ref('');
const nota = ref('');
const entrada = ref(null);
const previaRota = ref(false);

const esVideo = computed(() => props.kind === 'video');
const aceptados = computed(() => (esVideo.value
  ? '.mp4,.webm'
  : '.svg,.png,.jpg,.jpeg,.webp'));

/** Assets ya subidos del mismo tipo, para reusar sin volver a subir. */
const reutilizables = computed(
  () => props.assets.filter((a) => a.kind === props.kind),
);

/** Una `data:` URI incrustada no se puede previsualizar como URL remota. */
const esDataUri = computed(() => String(props.modelValue ?? '').startsWith('data:'));

async function subir(evento) {
  const fichero = evento.target.files?.[0];
  if (!fichero) return;
  subiendo.value = true;
  error.value = '';
  nota.value = '';
  try {
    const res = await api.uploadAsset(props.gameId, fichero);
    if (!res.ok) {
      error.value = res.error ?? 'No se pudo subir.';
      return;
    }
    previaRota.value = false;
    emit('update:modelValue', res.url);
    emit('assets-changed');
    nota.value = `${res.destino === 'r2' ? 'R2' : 'repo'}`
      + ` · ${Math.round(res.bytes / 1024)} KB · ${res.nota}`;
  } catch (err) {
    error.value = String(err.message ?? err);
  } finally {
    subiendo.value = false;
    if (entrada.value) entrada.value.value = '';
  }
}
</script>

<template>
  <div class="asset">
    <div class="previa" :class="{ rota: previaRota }">
      <template v-if="!modelValue">
        <span class="debil">sin archivo</span>
      </template>
      <template v-else-if="esVideo">
        <video :src="modelValue" controls muted preload="metadata" />
      </template>
      <template v-else>
        <img
          :src="modelValue"
          alt=""
          @error="previaRota = true"
          @load="previaRota = false"
        >
      </template>
    </div>

    <div class="controles">
      <input
        ref="entrada"
        type="file"
        :accept="aceptados"
        :disabled="subiendo"
        @change="subir"
      >

      <div class="url">
        <input
          type="text"
          :value="esDataUri ? '(data: URI incrustada)' : modelValue"
          :readonly="esDataUri"
          placeholder="https://…  ·  /assets/…  ·  data:…"
          @input="emit('update:modelValue', $event.target.value)"
        >
        <button
          v-if="modelValue"
          type="button"
          class="quitar"
          title="Vaciar"
          @click="emit('update:modelValue', '')"
        >×</button>
      </div>

      <details v-if="reutilizables.length" class="reusar">
        <summary>Reusar uno ya subido ({{ reutilizables.length }})</summary>
        <ul>
          <li v-for="a in reutilizables" :key="a.url">
            <button type="button" @click="emit('update:modelValue', a.url)">
              {{ a.name }}
            </button>
            <span class="debil mono">{{ Math.round(a.bytes / 1024) }} KB</span>
          </li>
        </ul>
      </details>
    </div>

    <p v-if="subiendo" class="tenue estado">Subiendo…</p>
    <pre v-if="error" class="error">{{ error }}</pre>
    <p v-if="nota" class="ok estado">{{ nota }}</p>
    <p v-if="previaRota && modelValue" class="aviso estado">
      ⚠️ La vista previa no carga. Esa URL dará un anuncio en blanco: ni el
      juego ni la consola avisarán de ello.
    </p>
  </div>
</template>

<style scoped>
.asset { display: grid; gap: 8px; }

.previa {
  display: grid; place-items: center;
  min-height: 120px; max-height: 220px;
  padding: 8px;
  background:
    repeating-conic-gradient(#1a1f2b 0% 25%, #141922 0% 50%) 50% / 16px 16px;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  overflow: hidden;
}
.previa.rota { border-color: var(--aviso); }
.previa img, .previa video { max-width: 100%; max-height: 200px; }

.controles { display: grid; gap: 6px; }
.controles input[type='file'] { font-size: 12px; color: var(--texto-tenue); }

.url { display: flex; gap: 6px; align-items: center; }
.quitar { border: none; background: none; color: var(--texto-debil); padding: 0 6px; }
.quitar:hover { color: var(--error); }

.reusar { font-size: 12px; color: var(--texto-tenue); }
.reusar ul { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
.reusar li { display: flex; gap: 8px; align-items: center; }
.reusar button { font-size: 12px; padding: 2px 8px; }

.estado { margin: 0; font-size: 12px; }
.ok { color: var(--ok); }
.aviso { color: var(--aviso); }
.error {
  margin: 0; padding: 8px;
  background: #2a1416; border: 1px solid var(--error); border-radius: var(--radio);
  color: #ffb4b0; font-size: 12px; white-space: pre-wrap;
}
</style>
