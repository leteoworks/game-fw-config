<script setup>
import { computed } from 'vue';

import AssetInput from './AssetInput.vue';
import DurationInput from './DurationInput.vue';
import LocaleMapInput from './LocaleMapInput.vue';
import StringListInput from './StringListInput.vue';

/**
 * Pinta UN campo: etiqueta, descripcion, control idoneo y estado.
 *
 * ## Las tres cosas que este componente no deja que se confundan
 *
 * 1. **«Sin definir» ≠ «apagado».** El JSON solo lleva lo que se ha fijado a
 *    proposito; lo demas lo resuelve el juego con su default. Un campo
 *    ausente se pinta atenuado y con su default a la vista, y **no se escribe
 *    hasta que se toca**. Si se escribieran todos al abrir, cambiar un
 *    default en el codigo del juego dejaria de tener efecto para siempre.
 * 2. **`null` ≠ vacio ≠ 0.** Donde el schema admite null, se ofrece como un
 *    estado con nombre. En `ttlMs`, null es «no mostrar nunca» y 0 es «para
 *    siempre»: son opuestos.
 * 3. **Este canal ≠ los otros.** Si el valor difiere de otro canal se dice,
 *    porque el error tipico es tocar `beta` creyendo que se toca `prod`.
 */

const props = defineProps({
  field: { type: Object, required: true },
  gameId: { type: String, required: true },
  assets: { type: Array, default: () => [] },
  errors: { type: Array, default: () => [] },
});
const emit = defineEmits(['set', 'unset', 'assets-changed']);

const f = computed(() => props.field);

/** Valor a enseñar: el escrito o, si no hay, el default del schema. */
const valorMostrado = computed(
  () => (f.value.present ? f.value.value : f.value.default),
);

const misErrores = computed(
  () => props.errors.filter((e) => e.path === f.value.path),
);

function set(valor) {
  emit('set', { path: f.value.path, value: valor });
}

/** Texto del default para el estado «sin definir». */
const textoDefault = computed(() => {
  const d = f.value.default;
  if (d === undefined) return 'sin default declarado';
  return `por defecto: ${JSON.stringify(d)}`;
});

/** Al «definir» un campo se siembra su default, no un valor inventado. */
function definir() {
  const d = f.value.default;
  if (d !== undefined) { set(d); return; }
  const porTipo = {
    boolean: false,
    number: f.value.minimum ?? 0,
    integer: f.value.minimum ?? 0,
    array: [],
    object: {},
    string: f.value.enum?.[0] ?? '',
  };
  set(porTipo[f.value.types[0]] ?? '');
}

const resumen = (v) => {
  if (v === undefined) return 'sin definir';
  const texto = JSON.stringify(v);
  return texto.length > 42 ? `${texto.slice(0, 42)}…` : texto;
};
</script>

<template>
  <div class="campo" :class="{ ausente: !f.present, malo: misErrores.length }">
    <div class="cabecera">
      <label class="etiqueta">
        {{ f.label }}
        <code class="ruta">{{ f.path }}</code>
      </label>

      <div class="acciones">
        <span v-if="!f.present" class="chip ausente-chip">sin definir</span>
        <button
          v-if="f.present"
          type="button"
          class="mini"
          title="Volver a «sin definir»: el juego usará su valor por defecto"
          @click="emit('unset', { path: f.path })"
        >restablecer</button>
        <button
          v-else
          type="button"
          class="mini"
          title="Fijar este campo en el JSON"
          @click="definir"
        >definir</button>
      </div>
    </div>

    <p v-if="f.description" class="descripcion">{{ f.description }}</p>

    <div class="control" :class="{ inerte: !f.present }">
      <!-- booleano -->
      <label v-if="f.widget === 'toggle'" class="interruptor">
        <input
          type="checkbox"
          :checked="valorMostrado === true"
          @change="set($event.target.checked)"
        >
        <span>{{ valorMostrado === true ? 'activado' : 'desactivado' }}</span>
      </label>

      <!-- enum corto -->
      <div v-else-if="f.widget === 'radio'" class="radios">
        <label v-for="op in f.enum" :key="op">
          <input
            type="radio"
            :name="f.path"
            :checked="valorMostrado === op"
            @change="set(op)"
          >
          <span class="mono">{{ op }}</span>
        </label>
      </div>

      <!-- enum largo -->
      <select
        v-else-if="f.widget === 'select'"
        :value="valorMostrado"
        @change="set($event.target.value)"
      >
        <option v-for="op in f.enum" :key="op" :value="op">{{ op }}</option>
      </select>

      <!-- porcentaje -->
      <div v-else-if="f.widget === 'percent'" class="deslizador">
        <input
          type="range"
          min="0"
          max="100"
          :value="Number(valorMostrado ?? 0)"
          @input="set(Number($event.target.value))"
        >
        <input
          type="number"
          class="numerico"
          min="0"
          max="100"
          :value="valorMostrado"
          @input="set(Number($event.target.value))"
        >
        <span class="unidad">%</span>
      </div>

      <!-- numero con rango -->
      <div v-else-if="f.widget === 'range'" class="deslizador">
        <input
          type="range"
          :min="f.minimum"
          :max="f.maximum"
          :value="Number(valorMostrado ?? f.minimum ?? 0)"
          @input="set(Number($event.target.value))"
        >
        <input
          type="number"
          class="numerico"
          :min="f.minimum"
          :max="f.maximum"
          :value="valorMostrado"
          @input="set(Number($event.target.value))"
        >
      </div>

      <!-- duracion -->
      <DurationInput
        v-else-if="f.widget === 'duration'"
        :model-value="valorMostrado"
        :nullable="f.nullable"
        :minimum="f.minimum"
        :maximum="f.maximum"
        @update:model-value="set"
      />

      <!-- numero suelto -->
      <input
        v-else-if="f.widget === 'number'"
        type="number"
        :min="f.minimum"
        :max="f.maximum"
        :value="valorMostrado"
        @input="set($event.target.value === '' ? undefined : Number($event.target.value))"
      >

      <!-- version -->
      <div v-else-if="f.widget === 'version'" class="version">
        <input
          type="text"
          placeholder="1.0.0"
          :value="valorMostrado ?? ''"
          :disabled="valorMostrado === null"
          @input="set($event.target.value)"
        >
        <label v-if="f.nullable" class="nulo">
          <input
            type="checkbox"
            :checked="valorMostrado === null"
            @change="set($event.target.checked ? null : '')"
          >
          <span><code>null</code> — sin límite</span>
        </label>
      </div>

      <!-- assets -->
      <AssetInput
        v-else-if="f.widget === 'asset-image' || f.widget === 'asset-video'"
        :model-value="valorMostrado"
        :kind="f.widget === 'asset-video' ? 'video' : 'image'"
        :game-id="gameId"
        :assets="assets"
        @update:model-value="set"
        @assets-changed="emit('assets-changed')"
      />

      <!-- url -->
      <input
        v-else-if="f.widget === 'url'"
        type="url"
        placeholder="https://…"
        :value="valorMostrado ?? ''"
        @input="set($event.target.value)"
      >

      <!-- listas -->
      <StringListInput
        v-else-if="f.widget === 'string-list'"
        :model-value="valorMostrado"
        :items-schema="f.itemsSchema"
        :nullable="f.nullable"
        @update:model-value="set"
      />

      <!-- mapa por idioma -->
      <LocaleMapInput
        v-else-if="f.widget === 'locale-map'"
        :model-value="valorMostrado"
        @update:model-value="set"
      />

      <!-- texto largo -->
      <textarea
        v-else-if="f.widget === 'textarea'"
        rows="3"
        :value="valorMostrado ?? ''"
        @input="set($event.target.value)"
      />

      <!-- lo que no encaja: JSON crudo, dicho claramente -->
      <div v-else-if="f.widget === 'unsupported'" class="crudo">
        <p class="aviso">
          Este campo no tiene un control específico; se edita como JSON.
        </p>
        <textarea
          rows="4"
          :value="JSON.stringify(valorMostrado ?? null, null, 2)"
          @change="set(JSON.parse($event.target.value))"
        />
      </div>

      <!-- texto -->
      <input
        v-else
        type="text"
        :value="valorMostrado ?? ''"
        @input="set($event.target.value)"
      >
    </div>

    <p v-if="!f.present" class="pie debil">{{ textoDefault }}</p>

    <ul v-if="Object.keys(f.diffs).length" class="diffs">
      <li v-for="(v, canal) in f.diffs" :key="canal">
        <span class="canal">{{ canal }}</span>
        <span class="mono">{{ resumen(v) }}</span>
      </li>
    </ul>

    <ul v-if="misErrores.length" class="errores">
      <li v-for="(e, i) in misErrores" :key="i">{{ e.message }}</li>
    </ul>
  </div>
</template>

<style scoped>
.campo {
  padding: 12px 14px;
  border: 1px solid var(--borde-suave);
  border-radius: var(--radio);
  background: var(--panel);
}
.campo.ausente { background: transparent; border-style: dashed; }
.campo.malo { border-color: var(--error); }

.cabecera {
  display: flex; align-items: baseline; gap: 10px;
  justify-content: space-between; margin-bottom: 2px;
}
.etiqueta { font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
.ruta { font-size: 11px; color: var(--texto-debil); font-weight: 400; }

.acciones { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.mini { font-size: 11px; padding: 2px 8px; }
.chip {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--borde);
}
.ausente-chip { color: var(--texto-debil); }

.descripcion {
  margin: 4px 0 10px;
  font-size: 12.5px; line-height: 1.5;
  color: var(--texto-tenue);
}

.control.inerte { opacity: .5; }

.interruptor { display: inline-flex; align-items: center; gap: 8px; }
.interruptor input { width: auto; }

.radios { display: flex; flex-wrap: wrap; gap: 14px; }
.radios label { display: inline-flex; align-items: center; gap: 6px; }
.radios input { width: auto; }

.deslizador { display: flex; align-items: center; gap: 10px; }
.deslizador input[type='range'] { flex: 1 1 auto; }
.numerico { flex: 0 0 90px; }
.unidad { color: var(--texto-tenue); }

.version .nulo {
  display: flex; align-items: center; gap: 6px;
  margin-top: 6px; font-size: 12px; color: var(--texto-tenue);
}
.version .nulo input { width: auto; }

.crudo .aviso { margin: 0 0 6px; font-size: 12px; color: var(--aviso); }

.pie { margin: 6px 0 0; font-size: 11.5px; }

.diffs {
  list-style: none; margin: 8px 0 0; padding: 6px 8px;
  border-left: 2px solid var(--morado);
  background: #1a1526;
  border-radius: 0 var(--radio) var(--radio) 0;
  display: grid; gap: 2px;
}
.diffs li { display: flex; gap: 8px; font-size: 12px; }
.canal {
  flex: 0 0 46px; color: var(--morado); font-weight: 600; font-size: 11px;
  text-transform: uppercase;
}

.errores {
  margin: 8px 0 0; padding-left: 18px;
  color: var(--error); font-size: 12px;
}
</style>
