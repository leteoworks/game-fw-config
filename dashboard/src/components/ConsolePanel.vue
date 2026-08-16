<script setup>
import { computed } from 'vue';

/**
 * Salida CRUDA de las operaciones (git, despliegue, purga).
 *
 * ⚠️ Nada de resumir. Cuando un `git push` falla, lo que resuelve el problema
 * es el mensaje de git tal cual —`non-fast-forward`, el nombre de la rama, la
 * sugerencia del propio git—, no un «ha fallado» nuestro. Este panel existe
 * justo para eso: enseñar lo que diría la terminal.
 */

const props = defineProps({
  resultado: { type: Object, default: null },
  ocupado: { type: Boolean, default: false },
  titulo: { type: String, default: '' },
});
const emit = defineEmits(['cerrar']);

const pasos = computed(() => props.resultado?.steps ?? []);
const ok = computed(() => props.resultado?.ok === true);

const duracion = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
</script>

<template>
  <div class="consola">
    <header>
      <span class="titulo">{{ titulo || 'Salida' }}</span>
      <span v-if="ocupado" class="estado trabajando">ejecutando…</span>
      <span v-else-if="resultado" class="estado" :class="ok ? 'ok' : 'mal'">
        {{ ok ? '✓ correcto' : '✗ ha fallado' }}
      </span>
      <button type="button" class="cerrar" @click="emit('cerrar')">×</button>
    </header>

    <div class="cuerpo">
      <p v-if="!resultado && !ocupado" class="debil vacio">
        Aquí sale la salida de git, del despliegue y de la purga.
      </p>

      <div v-for="(paso, i) in pasos" :key="i" class="paso">
        <div class="paso-cab">
          <span class="marca" :class="paso.code === 0 ? 'ok' : 'mal'">
            {{ paso.code === 0 ? '✓' : '✗' }}
          </span>
          <code class="cmd">{{ paso.cmd }}</code>
          <span class="debil mono">{{ duracion(paso.ms) }}</span>
        </div>
        <pre v-if="paso.output.trim()">{{ paso.output.trimEnd() }}</pre>
      </div>

      <p v-if="ocupado && pasos.length === 0" class="tenue vacio">
        Trabajando…
      </p>
    </div>
  </div>
</template>

<style scoped>
.consola {
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--panel);
  display: flex; flex-direction: column;
  max-height: 46vh;
}

header {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--borde);
}
.titulo { font-weight: 600; font-size: 13px; }
.estado { font-size: 12px; margin-left: auto; }
.estado.ok { color: var(--ok); }
.estado.mal { color: var(--error); }
.estado.trabajando { color: var(--aviso); }
.cerrar { border: none; background: none; color: var(--texto-debil); padding: 0 4px; }

.cuerpo { overflow-y: auto; padding: 10px 12px; }
.vacio { margin: 0; font-size: 12px; }

.paso { margin-bottom: 12px; }
.paso-cab { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.marca.ok { color: var(--ok); }
.marca.mal { color: var(--error); }
.cmd { font-size: 12px; color: var(--texto-tenue); }

pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--fondo);
  border: 1px solid var(--borde-suave);
  border-radius: var(--radio);
  font-size: 12px; line-height: 1.45;
  white-space: pre-wrap; word-break: break-word;
  max-height: 240px; overflow-y: auto;
}
</style>
