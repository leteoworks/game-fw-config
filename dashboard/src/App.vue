<script setup>
import { computed, onMounted, ref, watch } from 'vue';

import { api } from './api.mjs';
import AdsCampaignsPanel from './components/AdsCampaignsPanel.vue';
import ConsolePanel from './components/ConsolePanel.vue';
import FieldGroup from './components/FieldGroup.vue';
import { buildFormModel, deletePath, writePath } from './lib/schema-form.mjs';

/**
 * Dashboard de remote-config.
 *
 * ## El flujo, y por que son tres botones y no uno
 *
 *  - **Guardar**: escribe el JSON en LOCAL (validando antes). No publica.
 *  - **Publicar**: commit + pull + push **y despliega el Worker**. Desde
 *    ADR-038 un `git push` a secas NO deja el cambio vivo, asi que separarlos
 *    dejaria un boton que parece publicar y no publica.
 *  - **Purgar**: solo afecta a las releases ANTIGUAS (las que leen jsDelivr).
 *    Se mantiene aparte porque no es parte de publicar: es una reparacion
 *    para una poblacion concreta, con un limite que no se puede sortear.
 */

const juegos = ref([]);
const juego = ref(null);
const canal = ref(null);
const estadoGit = ref(null);

const datos = ref(null);        // JSON en edicion
const original = ref(null);     // copia recien cargada (para "descartar")
const schema = ref(null);
const otrosCanales = ref({});
const ui = ref(null);
const assets = ref([]);

const seccionActiva = ref(null);
const errores = ref([]);
const cargando = ref(false);
const guardando = ref(false);

const opTitulo = ref('');
const opResultado = ref(null);
const opOcupada = ref(false);
const consolaVisible = ref(false);

const modelo = computed(() => (schema.value && datos.value
  ? buildFormModel(schema.value, {
    data: datos.value,
    otherChannels: otrosCanales.value,
    ui: ui.value,
  })
  : null));

const secciones = computed(() => modelo.value?.sections ?? []);
const seccion = computed(
  () => secciones.value.find((s) => s.key === seccionActiva.value) ?? null,
);

const sucio = computed(
  () => JSON.stringify(datos.value) !== JSON.stringify(original.value),
);

const canales = computed(
  () => juegos.value.find((j) => j.id === juego.value)?.channels ?? [],
);

/** Nº de campos definidos por sección, para la pestaña. */
function contarDefinidos(nodo) {
  if (nodo.kind === 'field') return nodo.present ? 1 : 0;
  return (nodo.children ?? []).reduce((n, h) => n + contarDefinidos(h), 0);
}

/** Errores de validación que caen dentro de una sección. */
function erroresDe(clave) {
  return errores.value.filter((e) => e.path === clave || e.path.startsWith(`${clave}.`));
}

async function arrancar() {
  const info = await api.bootstrap();
  juegos.value = info.games;
  estadoGit.value = info.status;
  juego.value = info.games[0]?.id ?? null;
  canal.value = info.games[0]?.channels.includes('beta')
    ? 'beta'
    : info.games[0]?.channels[0] ?? null;
}

async function cargar() {
  if (!juego.value || !canal.value) return;
  cargando.value = true;
  errores.value = [];
  try {
    const res = await api.loadConfig(juego.value, canal.value);
    datos.value = res.data;
    original.value = JSON.parse(JSON.stringify(res.data));
    schema.value = res.schema;
    otrosCanales.value = res.otherChannels;
    ui.value = res.ui ?? null;
    assets.value = res.assets ?? [];
    if (!secciones.value.some((s) => s.key === seccionActiva.value)) {
      seccionActiva.value = secciones.value[0]?.key ?? null;
    }
  } finally {
    cargando.value = false;
  }
}

async function refrescarAssets() {
  const res = await api.loadConfig(juego.value, canal.value);
  assets.value = res.assets ?? [];
}

function alFijar({ path, value }) {
  datos.value = writePath(datos.value, path, value);
}

function alQuitar({ path }) {
  datos.value = deletePath(datos.value, path);
}

function descartar() {
  datos.value = JSON.parse(JSON.stringify(original.value));
  errores.value = [];
}

async function guardar() {
  guardando.value = true;
  try {
    const res = await api.saveConfig(juego.value, canal.value, datos.value);
    errores.value = res.errors ?? [];
    if (res.ok) {
      original.value = JSON.parse(JSON.stringify(datos.value));
      estadoGit.value = await api.status();
    }
  } finally {
    guardando.value = false;
  }
}

async function ejecutar(titulo, accion) {
  opTitulo.value = titulo;
  opResultado.value = null;
  opOcupada.value = true;
  consolaVisible.value = true;
  try {
    opResultado.value = await accion();
  } catch (err) {
    opResultado.value = {
      ok: false,
      steps: [{ cmd: titulo, code: 1, output: String(err.message ?? err), ms: 0 }],
    };
  } finally {
    opOcupada.value = false;
    estadoGit.value = await api.status().catch(() => estadoGit.value);
  }
}

const publicar = () => ejecutar(
  'Publicar (git + despliegue del Worker)',
  () => api.publish(`config(${juego.value}): cambios desde el dashboard`),
);
const purgar = () => ejecutar(
  `Purgar jsDelivr · ${juego.value}`,
  () => api.purge(juego.value),
);
const desplegar = () => ejecutar(
  'Desplegar el Worker (sin tocar git)',
  () => api.deploy(),
);

onMounted(arrancar);
watch([juego, canal], cargar);
</script>

<template>
  <div class="app">
    <header class="barra">
      <div class="marca">
        <strong>remote-config</strong>
        <span class="debil mono">dashboard local</span>
      </div>

      <label class="selector">
        Juego
        <select v-model="juego">
          <option v-for="j in juegos" :key="j.id" :value="j.id">{{ j.id }}</option>
        </select>
      </label>

      <label class="selector">
        Canal
        <select v-model="canal">
          <option v-for="c in canales" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>

      <div class="git" v-if="estadoGit">
        <span class="mono debil">{{ estadoGit.branch }}</span>
        <span v-if="estadoGit.dirty" class="chip aviso-chip">
          {{ estadoGit.dirtyFiles.length }} sin commitear
        </span>
        <span v-if="estadoGit.unpushed.length" class="chip aviso-chip">
          {{ estadoGit.unpushed.length }} sin pushear
        </span>
        <span v-if="!estadoGit.superproject" class="chip mal-chip"
              title="Sin el superproyecto no se puede desplegar ni purgar">
          sin superproyecto
        </span>
      </div>

      <div class="acciones">
        <button type="button" :disabled="!sucio" @click="descartar">
          Descartar
        </button>
        <button
          type="button" class="primario"
          :disabled="!sucio || guardando"
          @click="guardar"
        >
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
        <button type="button" :disabled="opOcupada" @click="publicar">
          Publicar
        </button>
        <button type="button" :disabled="opOcupada" @click="desplegar">
          Desplegar
        </button>
        <button type="button" class="peligro" :disabled="opOcupada" @click="purgar">
          Purgar
        </button>
      </div>
    </header>

    <p v-if="sucio" class="cinta">
      Hay cambios sin guardar. <strong>Guardar</strong> los escribe en el JSON
      local; para que lleguen al juego hace falta <strong>Publicar</strong>.
    </p>

    <p v-if="errores.length" class="cinta mala">
      El JSON no valida contra el schema ({{ errores.length }} error/es). No se
      ha escrito nada: los campos culpables salen marcados en rojo.
    </p>

    <nav class="pestanas">
      <button
        v-for="s in secciones"
        :key="s.key"
        type="button"
        class="pestana"
        :class="{ activa: s.key === seccionActiva, ausente: !s.present }"
        @click="seccionActiva = s.key"
      >
        {{ s.label }}
        <span class="conteo mono">{{ contarDefinidos(s) }}</span>
        <span v-if="erroresDe(s.key).length" class="punto-error" />
      </button>
    </nav>

    <main class="contenido">
      <p v-if="cargando" class="tenue">Cargando…</p>
      <!--
        Vista de conjunto de las campañas, ANTES del formulario: con
        varias simultaneas, lo que hay que revisar no es un campo suelto
        sino si el reparto del parque tiene sentido (huecos, solapes,
        campañas tapadas). El detalle se sigue editando abajo.
      -->
      <AdsCampaignsPanel
        v-if="!cargando && seccionActiva === 'ads' && datos"
        :datos="datos"
        @set="alFijar"
      />
      <FieldGroup
        v-else-if="seccion"
        :key="`${juego}-${canal}-${seccion.key}`"
        :node="seccion"
        :data="datos"
        :game-id="juego"
        :assets="assets"
        :errors="errores"
        :ui="ui"
        @set="alFijar"
        @unset="alQuitar"
        @assets-changed="refrescarAssets"
      />
    </main>

    <aside v-if="consolaVisible" class="panel-consola">
      <ConsolePanel
        :resultado="opResultado"
        :ocupado="opOcupada"
        :titulo="opTitulo"
        @cerrar="consolaVisible = false"
      />
    </aside>
  </div>
</template>

<style scoped>
.app { min-height: 100vh; display: flex; flex-direction: column; }

.barra {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--borde);
  position: sticky; top: 0; z-index: 10;
  flex-wrap: wrap;
}
.marca { display: flex; align-items: baseline; gap: 8px; }

.selector { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--texto-tenue); }
.selector select { width: auto; min-width: 130px; }

.git { display: flex; align-items: center; gap: 8px; }
.chip {
  font-size: 11px; padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--borde);
}
.aviso-chip { color: var(--aviso); border-color: var(--aviso); }
.mal-chip { color: var(--error); border-color: var(--error); }

.acciones { display: flex; gap: 8px; margin-left: auto; }

.cinta {
  margin: 0; padding: 8px 16px;
  background: var(--acento-tenue);
  border-bottom: 1px solid var(--borde);
  font-size: 12.5px;
}
.cinta.mala { background: #3a1418; color: #ffb4b0; }

.pestanas {
  display: flex; gap: 4px; padding: 10px 16px 0;
  border-bottom: 1px solid var(--borde);
  overflow-x: auto;
}
.pestana {
  border: 1px solid transparent; border-bottom: none;
  background: none; border-radius: var(--radio) var(--radio) 0 0;
  padding: 7px 14px; color: var(--texto-tenue);
  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
}
.pestana.activa {
  background: var(--fondo);
  border-color: var(--borde);
  color: var(--texto); font-weight: 600;
  margin-bottom: -1px;
}
.pestana.ausente { opacity: .6; font-style: italic; }
.conteo {
  background: var(--panel-alto); border-radius: 999px;
  padding: 0 6px; font-size: 11px; color: var(--texto-debil);
}
.punto-error {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--error);
}

.contenido {
  flex: 1 1 auto;
  padding: 20px 16px 40px;
  max-width: 1080px; width: 100%;
}

.panel-consola {
  position: sticky; bottom: 0;
  padding: 0 16px 16px;
  background: linear-gradient(transparent, var(--fondo) 18px);
}
</style>
