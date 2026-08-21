<script setup>
import { computed, ref } from 'vue';

import { blankItem, buildItemSubtree, readPath } from '../lib/schema-form.mjs';
import FieldControl from './FieldControl.vue';

/**
 * Pinta un GRUPO del formulario: su descripcion y, dentro, sus campos, sus
 * sub-grupos y sus listas de objetos.
 *
 * Es recursivo (se usa a si mismo), que es lo que permite que un `ads.banners`
 * de cuatro niveles salga solo del schema, sin escribir una plantilla por
 * nivel.
 *
 * ⚠️ Un grupo puede estar ENTERO ausente del JSON (`ads` no existe en
 * `prod.json`). Se dice explicitamente y se ofrece crearlo, en vez de pintar
 * sus campos vacios: unos campos vacios parecen configurados a cero, que en
 * `ads` significaria «hay publicidad y esta apagada» en vez de «este canal no
 * tiene publicidad».
 */

const props = defineProps({
  node: { type: Object, required: true },
  data: { type: Object, required: true },
  gameId: { type: String, required: true },
  assets: { type: Array, default: () => [] },
  errors: { type: Array, default: () => [] },
  // Los textos en espanol tienen que BAJAR hasta el ultimo nivel: sin esto,
  // los campos dentro de una tarjeta (un banner, un destino de analitica)
  // salian con su clave en ingles y sin explicacion, que es justo donde mas
  // falta hace.
  ui: { type: Object, default: null },
  nivel: { type: Number, default: 0 },
});
const emit = defineEmits(['set', 'unset', 'assets-changed']);

const colapsado = ref(false);

const hijos = computed(() => props.node.children ?? []);

/** Campos hoja y sub-grupos, separados para pintarlos en distinto orden. */
const campos = computed(() => hijos.value.filter((h) => h.kind === 'field'));
const grupos = computed(() => hijos.value.filter((h) => h.kind === 'group'));

/** ¿Cuántos campos de este grupo (y sus hijos) están definidos? */
function contarDefinidos(nodo) {
  if (nodo.kind === 'field') return nodo.present ? 1 : 0;
  return (nodo.children ?? []).reduce((n, h) => n + contarDefinidos(h), 0);
}
function contarTotal(nodo) {
  if (nodo.kind === 'field') return 1;
  return (nodo.children ?? []).reduce((n, h) => n + contarTotal(h), 0);
}
const definidos = computed(() => contarDefinidos(props.node));
const total = computed(() => contarTotal(props.node));

/**
 * Seccion `next-boot` (ADR-040): el juego CONGELA su valor al completar el
 * arranque y lo que llegue despues entra en el siguiente. Hay que decirlo
 * en la cabecera, porque quien publica un cambio aqui y «no lo ve» en el
 * movil que tiene delante concluiria que no ha llegado — y ha llegado, solo
 * que espera al proximo arranque.
 */
const siguienteArranque = computed(
  () => props.node.schema?.['x-apply'] === 'next-boot',
);
const EXPLICACION_SIGUIENTE_ARRANQUE =
  'Los cambios de esta sección no entran en caliente. El juego congela su '
  + 'valor cuando termina de arrancar y aplica lo que llegue después en el '
  + 'siguiente arranque (para que un parámetro no cambie a mitad de '
  + 'partida). Para verlo en un dispositivo: cerrar la app del todo y '
  + 'volver a abrirla. Un kill-switch o una campaña (secciones «live») sí '
  + 'entran al instante.';

/** Listas de objetos: cada elemento se pinta como una tarjeta. */
function elementosDe(campo) {
  const lista = readPath(props.data, campo.path);
  if (!Array.isArray(lista)) return [];
  return lista.map((_, i) => buildItemSubtree({
    itemsSchema: campo.itemsSchema,
    basePath: campo.path,
    index: i,
    data: props.data,
    ui: props.ui,
    genericBase: campo.generic,
  }));
}

function anadirElemento(campo) {
  const lista = readPath(props.data, campo.path) ?? [];
  emit('set', {
    path: `${campo.path}.${lista.length}`,
    value: blankItem(campo.itemsSchema),
  });
}

function quitarElemento(campo, indice) {
  emit('unset', { path: `${campo.path}.${indice}` });
}

/** Sube o baja un elemento: en `banners` el ORDEN decide cuál gana. */
function moverElemento(campo, desde, hacia) {
  const lista = readPath(props.data, campo.path) ?? [];
  if (hacia < 0 || hacia >= lista.length) return;
  const copia = [...lista];
  const [movido] = copia.splice(desde, 1);
  copia.splice(hacia, 0, movido);
  emit('set', { path: campo.path, value: copia });
}

/**
 * Mapas de clave libre → objeto (`analytics.providers`).
 *
 * Cada clave se pinta como un sub-grupo con el schema de
 * `additionalProperties`. ⚠️ Las claves NO son libres de verdad aunque el
 * schema lo permita: el juego solo reconoce los ids de destino que registra
 * (`posthog`, `gamefw`), y uno inventado se ignora EN SILENCIO. Por eso se
 * sugieren los conocidos en vez de dejar solo un campo de texto.
 */
const DESTINOS_CONOCIDOS = ['posthog', 'gamefw'];

function clavesDe(campo) {
  const mapa = readPath(props.data, campo.path);
  return mapa && typeof mapa === 'object' ? Object.keys(mapa) : [];
}

function subarbolDe(campo, clave) {
  return buildItemSubtree({
    itemsSchema: campo.schema.additionalProperties,
    basePath: campo.path,
    index: clave,
    data: props.data,
    ui: props.ui,
    genericBase: campo.generic,
  });
}

const nuevaClave = ref('');

function anadirClave(campo, clave) {
  const k = String(clave ?? nuevaClave.value).trim();
  if (!k || clavesDe(campo).includes(k)) return;
  emit('set', { path: `${campo.path}.${k}`, value: {} });
  nuevaClave.value = '';
}

function sugerenciasDe(campo) {
  return DESTINOS_CONOCIDOS.filter((d) => !clavesDe(campo).includes(d));
}

const esListaObjetos = (c) => c.widget === 'object-list';
const esMapaObjetos = (c) => c.widget === 'object-map';
const camposSimples = computed(
  () => campos.value.filter((c) => !esListaObjetos(c) && !esMapaObjetos(c)),
);
const listasObjetos = computed(() => campos.value.filter(esListaObjetos));
const mapasObjetos = computed(() => campos.value.filter(esMapaObjetos));
</script>

<template>
  <section class="grupo" :class="[`nivel-${nivel}`, { ausente: !node.present }]">
    <header v-if="!node.isItemRoot" class="cabecera">
      <button type="button" class="plegar" @click="colapsado = !colapsado">
        {{ colapsado ? '▸' : '▾' }}
      </button>
      <h3>{{ node.label }}</h3>
      <span class="conteo mono">{{ definidos }}/{{ total }} definidos</span>
      <span
        v-if="siguienteArranque"
        class="chip siguiente-arranque"
        :title="EXPLICACION_SIGUIENTE_ARRANQUE"
      >se aplica al siguiente arranque</span>
      <button
        v-if="!node.present && nivel > 0"
        type="button"
        class="mini"
        @click="emit('set', { path: node.path, value: {} })"
      >crear sección</button>
    </header>

    <p v-if="node.description && !colapsado && !node.isItemRoot" class="descripcion">
      {{ node.description }}
    </p>

    <p v-if="!node.present && !colapsado" class="nota-ausente">
      Esta sección no existe en el JSON de este canal: el juego usa sus valores
      por defecto para todo lo de aquí dentro.
    </p>

    <p
      v-if="siguienteArranque && !colapsado && !node.isItemRoot"
      class="nota-siguiente"
    >
      {{ EXPLICACION_SIGUIENTE_ARRANQUE }}
    </p>

    <div v-if="!colapsado || node.isItemRoot" class="cuerpo">
      <div v-if="camposSimples.length" class="campos">
        <FieldControl
          v-for="campo in camposSimples"
          :key="campo.path"
          :field="campo"
          :game-id="gameId"
          :assets="assets"
          :errors="errors"
          @set="emit('set', $event)"
          @unset="emit('unset', $event)"
          @assets-changed="emit('assets-changed')"
        />
      </div>

      <!-- listas de objetos: tarjetas repetibles -->
      <div v-for="campo in listasObjetos" :key="campo.path" class="lista-obj">
        <div class="lista-cab">
          <h4>{{ campo.label }}</h4>
          <button type="button" class="mini" @click="anadirElemento(campo)">
            + añadir
          </button>
        </div>
        <p v-if="campo.description" class="descripcion">{{ campo.description }}</p>

        <div
          v-for="(item, i) in elementosDe(campo)"
          :key="`${campo.path}.${i}`"
          class="tarjeta"
        >
          <div class="tarjeta-cab">
            <span class="indice mono">#{{ i + 1 }}</span>
            <div class="tarjeta-acciones">
              <button
                type="button" class="mini" :disabled="i === 0"
                title="Subir (en banners, gana el primero aplicable)"
                @click="moverElemento(campo, i, i - 1)"
              >↑</button>
              <button
                type="button" class="mini"
                :disabled="i === elementosDe(campo).length - 1"
                @click="moverElemento(campo, i, i + 1)"
              >↓</button>
              <button
                type="button" class="mini peligro"
                @click="quitarElemento(campo, i)"
              >eliminar</button>
            </div>
          </div>
          <FieldGroup
            :node="item"
            :data="data"
            :game-id="gameId"
            :assets="assets"
            :errors="errors"
            :ui="ui"
            :nivel="nivel + 1"
            @set="emit('set', $event)"
            @unset="emit('unset', $event)"
            @assets-changed="emit('assets-changed')"
          />
        </div>

        <p v-if="elementosDe(campo).length === 0" class="debil vacio">
          Lista vacía.
        </p>
      </div>

      <!-- mapas de clave libre → objeto (destinos de analítica) -->
      <div v-for="campo in mapasObjetos" :key="campo.path" class="lista-obj">
        <div class="lista-cab">
          <h4>{{ campo.label }}</h4>
          <code class="ruta-mini">{{ campo.path }}</code>
        </div>
        <p v-if="campo.description" class="descripcion">{{ campo.description }}</p>

        <div v-for="clave in clavesDe(campo)" :key="clave" class="tarjeta">
          <div class="tarjeta-cab">
            <span class="indice mono">{{ clave }}</span>
            <button
              type="button" class="mini peligro"
              @click="emit('unset', { path: `${campo.path}.${clave}` })"
            >eliminar</button>
          </div>
          <FieldGroup
            :node="subarbolDe(campo, clave)"
            :data="data"
            :game-id="gameId"
            :assets="assets"
            :errors="errors"
            :ui="ui"
            :nivel="nivel + 1"
            @set="emit('set', $event)"
            @unset="emit('unset', $event)"
            @assets-changed="emit('assets-changed')"
          />
        </div>

        <p v-if="clavesDe(campo).length === 0" class="debil vacio">
          Sin destinos configurados: todos usan sus valores por defecto.
        </p>

        <div class="anadir-clave">
          <button
            v-for="d in sugerenciasDe(campo)"
            :key="d"
            type="button"
            class="mini"
            @click="anadirClave(campo, d)"
          >+ {{ d }}</button>
          <input
            v-model="nuevaClave"
            type="text"
            class="clave"
            placeholder="otro id…"
            @keydown.enter.prevent="anadirClave(campo)"
          >
          <span class="debil aviso-clave">
            ⚠️ Un id que el juego no registre se ignora en silencio.
          </span>
        </div>
      </div>

      <!-- sub-grupos -->
      <FieldGroup
        v-for="sub in grupos"
        :key="sub.path"
        :node="sub"
        :data="data"
        :game-id="gameId"
        :assets="assets"
        :errors="errors"
        :ui="ui"
        :nivel="nivel + 1"
        @set="emit('set', $event)"
        @unset="emit('unset', $event)"
        @assets-changed="emit('assets-changed')"
      />
    </div>
  </section>
</template>

<style scoped>
.grupo { margin-bottom: 18px; }
.grupo.nivel-1, .grupo.nivel-2, .grupo.nivel-3 {
  border-left: 2px solid var(--borde);
  padding-left: 14px;
  margin-left: 2px;
}
.grupo.ausente > .cabecera h3 { color: var(--texto-debil); }

.cabecera { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.cabecera h3 { margin: 0; font-size: 15px; }
.nivel-1 .cabecera h3, .nivel-2 .cabecera h3 { font-size: 13.5px; }

.plegar {
  border: none; background: none; padding: 0 2px;
  color: var(--texto-tenue); font-size: 12px;
}
.conteo { color: var(--texto-debil); }
.mini { font-size: 11px; padding: 2px 8px; }

.chip {
  font-size: 11px; padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--borde);
}
.siguiente-arranque {
  color: var(--morado); border-color: var(--morado); cursor: help;
}
.nota-siguiente {
  margin: 0 0 12px; padding: 8px 10px;
  border-left: 2px solid var(--morado);
  background: #1a1526;
  border-radius: 0 var(--radio) var(--radio) 0;
  font-size: 12px; line-height: 1.5; color: var(--texto-tenue);
  max-width: 82ch;
}

.descripcion {
  margin: 4px 0 12px;
  font-size: 12.5px; line-height: 1.55;
  color: var(--texto-tenue);
  max-width: 82ch;
}

.nota-ausente {
  margin: 0 0 12px; padding: 8px 10px;
  background: var(--panel); border: 1px dashed var(--borde);
  border-radius: var(--radio);
  font-size: 12px; color: var(--texto-tenue);
}

.campos { display: grid; gap: 10px; margin-bottom: 16px; }

.lista-obj { margin-bottom: 16px; }
.lista-cab { display: flex; align-items: center; gap: 10px; }
.lista-cab h4 { margin: 0; font-size: 13.5px; }

.tarjeta {
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--panel);
  padding: 10px 12px;
  margin-bottom: 10px;
}
.tarjeta-cab {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px;
}
.indice { color: var(--acento); font-weight: 600; }
.tarjeta-acciones { display: flex; gap: 6px; }

.vacio { font-size: 12px; margin: 4px 0 0; }

.ruta-mini { font-size: 11px; color: var(--texto-debil); }
.anadir-clave { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.clave { width: 150px; font-size: 12px; padding: 4px 8px; }
.aviso-clave { font-size: 11px; }
</style>
