<script setup>
import { computed, ref } from 'vue';

/**
 * Campo de milisegundos con lectura humana y unidad elegible.
 *
 * ⚠️ Estos campos son los que mas se prestan a un error caro: `cooldownMs`
 * admite hasta 2 592 000 000 (30 dias) y a ojo no hay forma de distinguir
 * 86400000 de 8640000 — un cero de menos convierte «una vez al dia» en «diez
 * veces al dia». Por eso debajo siempre se lee la traduccion en palabras.
 *
 * Y el `null` NO es lo mismo que el `0`: en `ttlMs`, null significa «no
 * mostrar nunca» y 0 significa «para siempre». Cuando el schema admite null,
 * se ofrece como un estado aparte y explicado, nunca como un campo vacio.
 */

const props = defineProps({
  modelValue: { type: [Number, null], default: undefined },
  nullable: { type: Boolean, default: false },
  minimum: { type: Number, default: undefined },
  maximum: { type: Number, default: undefined },
  nullLabel: { type: String, default: 'sin limite' },
});
const emit = defineEmits(['update:modelValue']);

const UNIDADES = [
  { id: 'ms', etiqueta: 'ms', factor: 1 },
  { id: 's', etiqueta: 'segundos', factor: 1000 },
  { id: 'min', etiqueta: 'minutos', factor: 60_000 },
  { id: 'h', etiqueta: 'horas', factor: 3_600_000 },
  { id: 'd', etiqueta: 'dias', factor: 86_400_000 },
];

/** Unidad mas grande en la que el valor sea un entero: la mas legible. */
function mejorUnidad(ms) {
  if (!Number.isFinite(ms) || ms === 0) return UNIDADES[0];
  return [...UNIDADES].reverse().find((u) => ms % u.factor === 0) ?? UNIDADES[0];
}

const unidad = ref(mejorUnidad(props.modelValue ?? 0).id);

const factor = computed(
  () => UNIDADES.find((u) => u.id === unidad.value)?.factor ?? 1,
);

const enUnidad = computed({
  get() {
    const ms = props.modelValue;
    return typeof ms === 'number' ? ms / factor.value : '';
  },
  set(v) {
    if (v === '' || v === null) return;
    emit('update:modelValue', Math.round(Number(v) * factor.value));
  },
});

/** Traduccion a palabras del valor en ms. */
const legible = computed(() => {
  const ms = props.modelValue;
  if (ms === null) return props.nullLabel;
  if (typeof ms !== 'number') return '';
  if (ms === 0) return '0 (inmediato / sin limite, segun el campo)';
  const partes = [];
  let resto = ms;
  for (const u of [...UNIDADES].reverse()) {
    if (u.factor === 1) break;
    const n = Math.floor(resto / u.factor);
    if (n > 0) { partes.push(`${n} ${u.etiqueta}`); resto -= n * u.factor; }
  }
  if (resto > 0) partes.push(`${resto} ms`);
  return partes.join(' ');
});

const esNull = computed(() => props.modelValue === null);
</script>

<template>
  <div class="duracion">
    <div class="fila">
      <input
        type="number"
        :value="enUnidad"
        :disabled="esNull"
        :min="minimum !== undefined ? minimum / factor : undefined"
        :max="maximum !== undefined ? maximum / factor : undefined"
        @input="enUnidad = $event.target.value"
      >
      <select v-model="unidad" :disabled="esNull">
        <option v-for="u in UNIDADES" :key="u.id" :value="u.id">
          {{ u.etiqueta }}
        </option>
      </select>
    </div>

    <label v-if="nullable" class="nulo">
      <input
        type="checkbox"
        :checked="esNull"
        @change="emit('update:modelValue', $event.target.checked ? null : 0)"
      >
      <span><code>null</code> — {{ nullLabel }}</span>
    </label>

    <p v-if="legible" class="legible">= {{ legible }}</p>
  </div>
</template>

<style scoped>
.fila { display: flex; gap: 8px; }
.fila input { flex: 1 1 auto; }
.fila select { flex: 0 0 120px; }
.nulo {
  display: flex; align-items: center; gap: 6px;
  margin-top: 6px; font-size: 12px; color: var(--texto-tenue);
}
.nulo input { width: auto; }
.legible {
  margin: 4px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--acento);
}
</style>
