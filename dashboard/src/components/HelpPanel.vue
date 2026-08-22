<script setup>
import { computed } from 'vue';

import { rolloutVocabulary } from '../lib/campaign-status.mjs';

/**
 * Ayuda para el OPERADOR: que es cada cosa, que hace cada boton y como se
 * comprueba una campaña antes y despues de publicarla.
 *
 * Esta escrita para alguien que no programa y vive aqui, en el dashboard,
 * porque es donde se toma la decision: un doc en el repo principal no se
 * abre a las 18:55 con una campaña que tiene que salir a las 19:00. Cada
 * bloque termina con enlaces a la referencia completa para quien quiera
 * profundizar.
 *
 * Las listas de variantes, tipos de dispositivo y segmentos se leen del
 * schema cargado (el generado desde el juego), no de un texto fijo: un
 * segmento nuevo en el juego aparece aqui solo.
 *
 * Desde ADR-041 cubre tambien idioma y pais (regla del prefijo, mayusculas
 * y minusculas, y por que sin pais conocido no se entra), los experimentos
 * A/B (asignacion, cuota esperada, SRM en Grafana, no cambiar la clave a
 * mitad), las capas de exclusion mutua, la identidad del sorteo, el
 * holdout global y el endpoint `/evaluate` del Worker. El orden de
 * evaluacion y la tabla de motivos son los del evaluador del juego
 * (`@modules/rollout/evaluate.ts`): si alli cambia algo, aqui tambien.
 */

const props = defineProps({
  /** El JSON Schema del juego cargado (para las listas reales). */
  schema: { type: Object, default: null },
  gameId: { type: String, default: '' },
  canal: { type: String, default: '' },
});

const DOCS = 'https://github.com/leteoworks/my-game-fw/blob/dev/';

const ENLACES = {
  readme: {
    href: `${DOCS}docs/architecture/remote-config-contracts/README.md`,
    texto: 'Contratos de remote-config (índice)',
  },
  design: {
    href: `${DOCS}docs/architecture/remote-config-contracts/design.md`,
    texto: 'Cómo está hecho y por qué',
  },
  guide: {
    href: `${DOCS}docs/architecture/remote-config-contracts/guide.md`,
    texto: 'Guía y recetas',
  },
  campaigns: {
    href: `${DOCS}docs/architecture/remote-config-contracts/campaigns.md`,
    texto: 'Operación de campañas',
  },
  recipes: {
    href: `${DOCS}docs/architecture/remote-config-contracts/recipes-campaigns.md`,
    texto: 'Recetas paso a paso',
  },
  cookbook: {
    href: `${DOCS}docs/architecture/ads/ads-campaign-cookbook.md`,
    texto: 'Recetario de campañas de publicidad',
  },
  runbook: {
    href: `${DOCS}docs/platform/remote-config-worker-runbook.md`,
    texto: 'Runbook del Worker de remote-config',
  },
  adr039: {
    href: `${DOCS}ADR-039-remote-config-contracts.md`,
    texto: 'ADR-039 — contratos de remote-config',
  },
  adr040: {
    href: `${DOCS}ADR-040-campaign-operations.md`,
    texto: 'ADR-040 — operación de campañas',
  },
  adr041: {
    href: `${DOCS}ADR-041-experiments-geo-evaluate.md`,
    texto: 'ADR-041 — experimentos, idioma/país y evaluación en el Worker',
  },
};

const profundizar = (...claves) => claves.map((k) => ENLACES[k]);

const INDICE = [
  { id: 'conceptos', titulo: 'Secciones, campañas y canales' },
  { id: 'botones', titulo: 'Los botones: Guardar, Publicar, Desplegar, Purgar' },
  { id: 'sobre', titulo: 'El sobre de despliegue, campo a campo' },
  { id: 'orden', titulo: 'En qué orden se decide (y los motivos de rechazo)' },
  { id: 'reparto', titulo: 'Varias campañas a la vez: reparto y tramos' },
  { id: 'experimentos', titulo: 'Experimentos A/B dentro de una campaña' },
  { id: 'capas', titulo: 'Capas de exclusión mutua y punto del parque' },
  { id: 'ops', titulo: 'La sección «Operación»: pánico, holdout y muestra' },
  { id: 'comprobar', titulo: 'Comprobar una campaña antes y después' },
  { id: 'higiene', titulo: 'Higiene: auditoría, diferencias entre canales' },
  { id: 'modo-seguro', titulo: 'El modo seguro del juego' },
  { id: 'next-boot', titulo: 'Secciones que se aplican al siguiente arranque' },
  { id: 'errores', titulo: 'Errores típicos' },
  { id: 'enlaces', titulo: 'Todos los enlaces' },
];

const vocab = computed(() => rolloutVocabulary(props.schema));

/** Listas reales del schema, con un respaldo por si aún no hay schema. */
const variantes = computed(() => vocab.value.variants ?? [
  'ios', 'android', 'browser', 'electron-windows', 'electron-linux',
  'electron-mac-steam', 'electron-mac-appstore',
]);
const dispositivos = computed(
  () => vocab.value.formFactors ?? ['phone', 'tablet', 'desktop'],
);
const segmentos = computed(() => (
  vocab.value.segmentDescriptors.length > 0
    ? vocab.value.segmentDescriptors
    : (vocab.value.segments ?? []).map((name) => ({ name, title: name, description: '' }))
));

const juego = computed(() => props.gameId || 'snake-classic');
</script>

<template>
  <article class="ayuda">
    <header class="ayuda__cabecera">
      <h1>Ayuda del dashboard</h1>
      <p class="ayuda__intro">
        Cómo funciona la configuración remota de <code>{{ juego }}</code> y
        cómo se opera una campaña sin sustos. Está pensada para leerse en
        cinco minutos la primera vez y para volver a un punto concreto
        después.
        <span v-if="canal">
          Ahora mismo estás editando el canal <strong>{{ canal }}</strong>.
        </span>
      </p>
      <nav class="ayuda__indice" aria-label="Índice">
        <ol>
          <li v-for="s in INDICE" :key="s.id">
            <a :href="`#${s.id}`">{{ s.titulo }}</a>
          </li>
        </ol>
      </nav>
    </header>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="conceptos" class="ayuda__bloque">
      <h2>1. Secciones, campañas y canales</h2>
      <p>
        El juego lee un fichero JSON con su configuración remota. Ese fichero
        está dividido en <strong>secciones</strong>: cada pestaña de arriba es
        una (Publicidad, Muro de pago, Aviso de versión, Analítica, Operación…).
        Una sección agrupa lo que gobierna una parte del juego, y la puede
        cambiar un operador sin publicar una versión nueva en las tiendas.
      </p>
      <p>
        Una <strong>campaña</strong> es una cosa concreta que se quiere enseñar
        o activar para una parte del público durante un tiempo: un anuncio de
        Navidad, un muro de pago para el 10 % de los veteranos, un aviso de
        actualización solo para Android. En la sección de Publicidad hay una
        lista de hasta 20 campañas; en otras secciones (muro, aviso de versión,
        profiling) la sección entera es una única campaña. Todas llevan el
        mismo <strong>sobre de despliegue</strong> (<code>rollout</code>), que
        es lo que decide <em>a quién le toca</em> (sección 3).
      </p>
      <p>
        Hay tres <strong>canales</strong>, y son tres ficheros distintos:
      </p>
      <ul>
        <li><code>dev</code>: solo lo leen las builds de desarrollo.</li>
        <li><code>beta</code>: lo leen las builds del canal beta (pruebas internas).</li>
        <li><code>prod</code>: lo leen todos los jugadores. Es el de verdad.</li>
      </ul>
      <p>
        El error más fácil de cometer es editar <code>beta</code> creyendo que
        se edita <code>prod</code>: por eso cada campo dice al lado si en otro
        canal vale otra cosa.
      </p>
      <p>
        Dos matices que la interfaz no deja confundir:
      </p>
      <ul>
        <li>
          <strong>«Sin definir» no es «apagado».</strong> Un campo que no está
          en el JSON lo decide el juego con su valor por defecto (sale
          atenuado, con ese valor a la vista). Solo se escribe si lo tocas.
        </li>
        <li>
          <strong><code>null</code> no es vacío ni cero.</strong> Donde el
          schema lo admite, <code>null</code> es un estado con nombre
          («sin fecha», «sin límite», «no mostrar nunca»), distinto de 0 y
          distinto de una lista vacía.
        </li>
      </ul>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('readme', 'design')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="botones" class="ayuda__bloque">
      <h2>2. Los botones: Guardar, Publicar, Desplegar, Purgar</h2>
      <table class="ayuda__tabla">
        <thead>
          <tr><th>Botón</th><th>Qué hace</th><th>Qué NO hace</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Descartar</strong></td>
            <td>Vuelve a lo que había al cargar. Tira tus cambios sin guardar.</td>
            <td>No toca el disco ni el juego.</td>
          </tr>
          <tr>
            <td><strong>Guardar</strong></td>
            <td>
              Valida el JSON contra el schema y lo escribe <em>en tu disco</em>.
              Si no valida, no escribe nada y marca en rojo los campos
              culpables.
            </td>
            <td>
              <strong>No publica.</strong> El juego sigue leyendo lo de antes.
              Guardar y cerrar el navegador es el error de operación más
              frecuente.
            </td>
          </tr>
          <tr>
            <td><strong>Publicar</strong></td>
            <td>
              Hace <code>commit</code>, <code>pull --rebase</code>,
              <code>push</code> <strong>y despliega el Worker</strong> que sirve
              el JSON, comprobando byte a byte contra la URL viva. En unos
              10 segundos las apps instaladas reciben el cambio en su
              siguiente consulta.
            </td>
            <td>
              No hace nada a medias: si el despliegue falla, la operación
              termina en rojo y lo ves en la consola de abajo, con la salida
              cruda de git y del despliegue.
            </td>
          </tr>
          <tr>
            <td><strong>Desplegar</strong></td>
            <td>
              Solo el Worker, con lo que hay guardado en disco, sin tocar git.
              Sirve para probar un cambio guardado antes de subirlo.
            </td>
            <td>
              No deja el cambio en el repositorio: si no publicas después, la
              siguiente publicación de otra persona lo pisa.
            </td>
          </tr>
          <tr>
            <td><strong>Purgar</strong></td>
            <td>
              Purga la caché de jsDelivr. Solo afecta a las
              <em>releases antiguas</em> (anteriores al Worker) que todavía
              leen de allí.
            </td>
            <td>
              No forma parte de publicar y no acelera el alias
              <code>@main</code>, que puede tardar hasta 12 horas: es el motivo
              por el que existe el Worker.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Regla práctica: <strong>Guardar → revisar el panel de campañas y los
        avisos → Publicar</strong>. Y después, comprobar en un dispositivo
        (sección 9).
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('runbook', 'campaigns')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="sobre" class="ayuda__bloque">
      <h2>3. El sobre de despliegue, campo a campo</h2>
      <p>
        Cada campaña (y cada sección gobernable) lleva un bloque
        <code>rollout</code>: el sobre. Es el mismo para publicidad, muros,
        aviso de versión y profiling, así que se aprende una vez. Decide a
        quién le toca, y se evalúa en el orden en que aparece aquí.
      </p>

      <h3>Interruptor (<code>enabled</code>)</h3>
      <p>
        Apagado, nada de lo que sigue se mira. Es el kill-switch de la
        campaña: para quitarla de en medio en un minuto no hace falta borrar
        nada, basta apagarla y publicar.
      </p>

      <h3>Variantes de distribución (<code>variants</code>)</h3>
      <p>
        Lista blanca de dónde se instaló el juego:
        <code v-for="v in variantes" :key="v" class="ayuda__lista-inline">{{ v }}</code>.
        <strong>Vacía o sin definir = todas.</strong> Ejemplo: una campaña que
        enlaza a la Play Store solo tiene sentido en <code>android</code>.
      </p>

      <h3>Tipos de dispositivo (<code>formFactors</code>)</h3>
      <p>
        Lista blanca:
        <code v-for="d in dispositivos" :key="d" class="ayuda__lista-inline">{{ d }}</code>.
        Vacía = todos. Ejemplo: una creatividad apaisada grande, solo en
        <code>tablet</code> y <code>desktop</code>.
      </p>

      <h3>Rango de versiones (<code>versions</code>)</h3>
      <p>
        Versiones instaladas de la app a las que aplica, mínima y máxima,
        ambas inclusive; vacío = todas. Sirve para empezar por los más
        atrasados («aviso de actualización para quien tenga menos de la
        1.0.130») o para excluir una versión con un problema conocido. Una
        versión que no se pueda leer <em>no restringe</em>: un rango mal
        escrito nunca deja a nadie fuera por accidente.
      </p>

      <h3>Idiomas (<code>locales</code>)</h3>
      <p>
        Lista blanca de idiomas del jugador, en <strong>minúsculas</strong> y
        con formato BCP-47: <code>es</code>, <code>es-es</code>,
        <code>pt-br</code>. Vacía = todos. <strong>La regla del prefijo:</strong>
        <code>es</code> vale para cualquier <code>es-*</code> (España, México,
        Argentina…); <code>es-es</code> solo vale para <code>es-es</code>. Así
        que para «todos los hispanohablantes» basta <code>es</code>, y para
        «solo el español de España» hay que escribir <code>es-es</code>. El
        idioma lo pone el dispositivo (el del sistema o el elegido en el
        juego). El editor enseña el formato debajo de la lista y marca en
        rojo lo que no lo cumple (mayúsculas, guiones bajos).
      </p>
      <p>
        No confundir con los <strong>textos por idioma</strong> del aviso de
        versión (<code>appUpdate.messages</code>): esta lista decide <em>a
        quién</em> llega una campaña; aquel mapa, <em>qué lee</em> cada
        jugador. Ese editor ofrece los idiomas del juego de un clic y dice
        cuáles se quedan sin texto propio — que <strong>no</strong> leen el
        texto genérico del juego en su idioma: leen el inglés publicado.
      </p>

      <h3>Países (<code>countries</code>)</h3>
      <p>
        Lista blanca de países en <strong>MAYÚSCULAS</strong> y dos letras
        (ISO 3166-1 alfa-2): <code>ES</code>, <code>MX</code>,
        <code>US</code>. Vacía = todos. El país <strong>no lo decide el
        móvil</strong>: lo determina el servidor de configuración a partir de
        la conexión, sin geolocalizar al jugador ni pedir permisos, y el juego
        lo guarda junto con la copia de la configuración. Dos consecuencias:
      </p>
      <ul>
        <li>
          <strong>Mayúsculas, siempre.</strong> El país que llega del servidor
          es <code>ES</code>, y se compara tal cual: un <code>es</code>
          escrito a mano no casaría con nadie, nunca, sin ningún error. El
          editor lo marca en rojo y el validador lo rechaza al guardar.
        </li>
        <li>
          <strong>Sin país conocido, una lista no vacía no deja entrar.</strong>
          En el primer arranque sin red (o si el servidor no pudo saberlo) el
          juego aún no tiene país. Ante la duda, fuera: equivocarse hacia
          «nadie» es más barato que enseñar a todo el mundo una campaña que
          era solo para un país (precios, legislación, idioma de la
          creatividad). Una VPN cambia el país que ve el servidor; es
          esperable y no se corrige.
        </li>
      </ul>

      <h3>Calendario (<code>schedule</code>)</h3>
      <p>
        Ventana «desde – hasta»: la campaña está viva a partir de «desde»
        (incluido) y deja de estarlo en «hasta» (excluido). Cualquiera de los
        dos puede quedar vacío («desde ya», «sin fin»). Permite publicar hoy
        una campaña que empieza el lunes y se apaga sola el domingo, sin
        volver a publicar.
      </p>
      <p>
        <strong>Por qué se usa la hora del servidor.</strong> Un dispositivo
        puede tener el reloj mal (un emulador, un móvil con la hora puesta a
        mano, una zona horaria equivocada). Si la campaña se comparara con
        esa hora, en un móvil saldría el lunes y en otro el martes. Por eso el
        juego corrige su reloj con la hora que le envía el servidor de
        configuración en cada respuesta, y compara el calendario con ese reloj
        corregido. El dashboard guarda siempre el instante en UTC (con la
        <code>Z</code> al final) y te lo enseña en tu hora local: debajo del
        campo ves las dos lecturas.
      </p>

      <h3>Segmentos (<code>segments</code>)</h3>
      <p>
        Grupos de jugadores que el juego define por su comportamiento. Se
        marcan con casillas, y el jugador <strong>tiene que cumplir TODOS</strong>
        los marcados; vacío = sin restricción. Los de este juego:
      </p>
      <dl v-if="segmentos.length" class="ayuda__segmentos">
        <template v-for="s in segmentos" :key="s.name">
          <dt><code>{{ s.name }}</code> · {{ s.title }}</dt>
          <dd>{{ s.description }}</dd>
        </template>
      </dl>
      <p v-else class="ayuda__nota">
        (No hay schema cargado: la lista real aparece al cargar un juego.)
      </p>
      <p>
        Ojo con combinarlos: marcar «jugadores nuevos» y «veteranos» a la vez
        no suma los dos públicos, los cruza, y nadie es las dos cosas. Un
        nombre que el juego no conozca no deja entrar a nadie (el dashboard
        solo ofrece los que existen, pero un JSON editado a mano puede
        traerlo).
      </p>

      <h3>Cohorte (<code>cohort</code>)</h3>
      <p>
        A qué parte del parque llega. Cada jugador ocupa un punto fijo entre
        0 y 100 en el eje de la sección, calculado a partir de su identidad
        anónima más una <em>sal</em>; ese punto no cambia entre arranques.
      </p>
      <ul>
        <li>
          <strong>Porcentaje</strong> (<code>percent</code>): entran los
          jugadores cuyo punto es menor que el porcentaje. Es
          <em>monótono</em>: subirlo solo añade gente (quien ya lo tenía lo
          conserva); bajarlo sí puede quitar. 100 = todo el mundo, incluida la
          primera sesión, cuando aún no hay identidad resuelta.
        </li>
        <li>
          <strong>Sal</strong> (<code>salt</code>): texto libre. Cambiarla
          <em>rebaraja</em> a todo el parque: gente que estaba dentro sale y
          viceversa. Es la palanca para volver a sortear (por ejemplo, poner
          la versión publicada para que cada release estrene sorteo).
          <strong>No tocarla a mitad de un despliegue por fases.</strong>
        </li>
        <li>
          <strong>Tramo</strong> (<code>audience</code>): compartimento
          «desde – hasta» del eje 0–100 (hasta excluido). Dos campañas con
          tramos que no se solapan reparten el parque en compartimentos
          estancos. Un tramo con desde ≥ hasta no deja entrar a nadie
          (equivocarse hacia «nadie» es más barato que hacia «todos»), y sin
          identidad estable (primer arranque) tampoco.
        </li>
        <li>
          <strong>Rampa programada</strong> (<code>ramp</code>): escalones
          «instante → porcentaje» que suben el porcentaje solos, sin publicar
          en cada paso. El porcentaje vigente es el del último escalón cuyo
          instante ya pasó; antes del primero manda el porcentaje de arriba.
        </li>
        <li>
          <strong>Capa</strong> (<code>layer</code>): sustituye el eje de la
          sección por uno compartido con campañas de <em>otras</em>
          secciones, para que sean excluyentes entre sí (el anuncio de
          Navidad y el muro de Navidad). Vacío = eje propio de la sección.
          Sección 7.
        </li>
        <li>
          <strong>Punto del parque por</strong> (<code>bucketBy</code>):
          <code>device</code>, la identidad anónima del dispositivo (el valor
          por defecto), o <code>user</code>, la cuenta del jugador, la misma
          en todos sus dispositivos. Sección 7.
        </li>
      </ul>
      <p><strong>Ejemplo de rampa 1 → 10 → 50 → 100:</strong></p>
      <pre class="ayuda__ejemplo">cohort:
  percent: 1                                   ← hoy, al publicar
  ramp:
    - at: 2026-09-07T08:00:00Z   percent: 10    ← lunes
    - at: 2026-09-10T08:00:00Z   percent: 50    ← jueves
    - at: 2026-09-13T08:00:00Z   percent: 100   ← domingo</pre>
      <p>
        Se publica una vez; el domingo llega a todos. Los escalones deberían
        <em>subir</em>: uno que baja es un rollback programado, y eso se hace
        a mano y mirando. El panel de campañas avisa si alguno baja.
      </p>
      <p class="ayuda__aviso">
        ⚠️ <strong>El porcentaje recorta el eje desde el 0; el tramo se aplica
        encima.</strong> Una campaña con tramo 50–100 y la rampa al 10 % no
        llega a nadie todavía (el 10 % son los puntos 0–10, y ninguno cae en
        50–100). El público real es «desde – mínimo(hasta, porcentaje)». El
        panel de campañas lo dibuja: el tramo en contorno, el alcance real en
        sólido, y avisa cuando el alcance queda vacío.
      </p>

      <h3>Experimento (<code>experiment</code>)</h3>
      <p>
        Un A/B dentro de la campaña: a quien <em>entra</em> se le asigna una
        variante con nombre (<code>control</code>, <code>precioAlto</code>…),
        estable y ponderada por peso, y la feature enseña una cosa u otra
        según ese nombre. Vacío = sin experimento. Es independiente del
        porcentaje y del tramo: esos deciden <em>quién entra</em>; el
        experimento, <em>qué ve</em> cada uno de los que entran. Sección 6.
      </p>

      <h3>Ficha (<code>meta</code>)</h3>
      <p>
        Nombre, responsable, ticket, notas y fecha del último cambio. El juego
        la ignora por completo; es para las personas: quien abra esto dentro
        de seis meses tiene que saber de quién es cada campaña y por qué
        existe. La auditoría (sección 10) la usa para detectar campañas
        huérfanas y caducadas. Rellena al menos <em>nombre</em> y
        <em>responsable</em>: el panel lo recuerda si faltan.
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('guide', 'campaigns', 'recipes', 'adr039', 'adr041')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="orden" class="ayuda__bloque">
      <h2>4. En qué orden se decide (y los motivos de rechazo)</h2>
      <p>
        El juego comprueba el sobre en este orden y se queda con el
        <strong>primer motivo que rechaza</strong>. Saberlo ayuda a leer el
        veredicto («rechazada por <code>schedule</code>») en el simulador, en
        el endpoint <code>/evaluate</code> y en la telemetría:
      </p>
      <ol class="ayuda__orden">
        <li>
          <strong>Override de QA</strong> — solo en builds de desarrollo o del
          canal beta: fuerza «dentro» o «fuera» sin mirar nada más.
        </li>
        <li>
          <strong>Pausa global</strong> (<code>ops.pauseCampaigns</code>) —
          el botón de pánico: todo rechazado como «pausado».
        </li>
        <li>
          <strong>Holdout global</strong> (<code>ops.holdoutPercent</code>) —
          el grupo de control: ese porcentaje del parque queda fuera de
          todas las campañas, en un eje propio (sección 8).
        </li>
        <li><strong>Interruptor</strong> (<code>enabled</code>).</li>
        <li><strong>Variantes</strong> de distribución.</li>
        <li><strong>Tipos de dispositivo</strong>.</li>
        <li><strong>Versiones</strong> instaladas.</li>
        <li><strong>Idiomas</strong> (por prefijo, en minúsculas).</li>
        <li>
          <strong>Países</strong> (el que vio el servidor; sin país conocido
          y lista no vacía, fuera).
        </li>
        <li><strong>Calendario</strong>, con el reloj corregido por el servidor.</li>
        <li><strong>Segmentos</strong> (todos los marcados).</li>
        <li>
          <strong>Cohorte</strong>: el porcentaje EFECTIVO (la rampa ya
          aplicada) contra el punto fijo del jugador, y encima el
          <strong>tramo</strong> (desde ≥ hasta = nadie). El punto se calcula
          sobre el eje de la sección —o el de la capa, si la hay— con la
          identidad del dispositivo o de la cuenta (<code>bucketBy</code>).
        </li>
        <li>
          <strong>Asignación de variante</strong> del experimento, si lo hay.
          Ya no rechaza a nadie: decide qué ve quien ha entrado.
        </li>
      </ol>
      <p>
        El motivo que sale en el veredicto, en el simulador, en
        <code>/evaluate</code> y en la telemetría es una de estas palabras:
      </p>
      <table class="ayuda__tabla">
        <thead><tr><th>Motivo</th><th>Qué lo rechazó</th></tr></thead>
        <tbody>
          <tr><td><code>forced</code></td><td>Un override de QA lo forzó «fuera» (solo dev/beta).</td></tr>
          <tr><td><code>paused</code></td><td>La pausa global de Operación.</td></tr>
          <tr><td><code>holdout</code></td><td>El jugador está en el grupo de control global.</td></tr>
          <tr><td><code>disabled</code></td><td>El interruptor de la campaña está apagado.</td></tr>
          <tr><td><code>variant</code></td><td>Su variante de distribución no está en la lista.</td></tr>
          <tr><td><code>form_factor</code></td><td>Su tipo de dispositivo no está en la lista.</td></tr>
          <tr><td><code>version</code></td><td>Su versión instalada queda fuera del rango.</td></tr>
          <tr><td><code>locale</code></td><td>Su idioma no casa con ninguno de la lista (o no se conoce).</td></tr>
          <tr><td><code>country</code></td><td>Su país no está en la lista, o el juego aún no lo conoce.</td></tr>
          <tr><td><code>schedule</code></td><td>Fuera de la ventana del calendario.</td></tr>
          <tr><td><code>segment</code></td><td>No cumple alguno de los segmentos exigidos (o uno es desconocido).</td></tr>
          <tr><td><code>cohort</code></td><td>Su punto del parque queda por encima del porcentaje efectivo.</td></tr>
          <tr><td><code>audience</code></td><td>Su punto cae fuera del tramo (o el tramo está invertido, o no hay identidad estable).</td></tr>
        </tbody>
      </table>
      <p>
        La publicidad añade sus propias comprobaciones alrededor del sobre:
        antes, que la campaña sea montable (tiene imagen, su duración no es
        «nunca», hay conexión); después, el cooldown (hace poco que se vio) y
        que el jugador no la haya cerrado ya en esta sesión. Y entre las
        campañas que pasan todo eso, decide el reparto (sección 5).
      </p>
      <p>
        Cada evaluación emite el evento de telemetría
        <code>rollout.evaluated</code> con el motivo (y, si hay experimento,
        la variante asignada y su cuota esperada), así que el alcance real de
        una campaña se puede leer después (sección 9).
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('design', 'adr040', 'adr041')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="reparto" class="ayuda__bloque">
      <h2>5. Varias campañas a la vez: reparto y tramos</h2>
      <p>
        En Publicidad pueden convivir hasta 20 campañas. Para un jugador
        concreto, primero se mira cuáles son <em>candidatas</em> (pasan su
        sobre y sus comprobaciones de publicidad) y luego, si hay más de una,
        la política de reparto (<code>pick</code>) elige:
      </p>
      <table class="ayuda__tabla">
        <thead><tr><th>Política</th><th>Cómo elige</th><th>Para qué</th></tr></thead>
        <tbody>
          <tr>
            <td><code>order</code> (orden)</td>
            <td>
              Gana la <strong>primera</strong> candidata de la lista; las
              siguientes ni se evalúan. Las flechas ↑ ↓ del formulario son,
              por tanto, una decisión de producto.
            </td>
            <td>Prioridades claras; una campaña «de relleno» al final.</td>
          </tr>
          <tr>
            <td><code>weighted</code> (sorteo por peso)</td>
            <td>
              Se sortea en <strong>cada arranque</strong> proporcionalmente al
              peso (<code>weight</code>) de cada candidata. El mismo jugador
              va viendo varias.
            </td>
            <td>Rotación de creatividades.</td>
          </tr>
          <tr>
            <td><code>sticky</code> (fijo por jugador)</td>
            <td>
              Reparte por peso, pero con el «dado» fijo del jugador: ve
              <strong>siempre la misma</strong>. Sin identidad estable degrada
              a sorteo.
            </td>
            <td>Tests A/B honestos sin tramos.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Si todos los pesos son 0, gana la primera (quedarse sin anuncio
        teniendo candidatas sería un fallo mudo).
      </p>
      <p>
        <strong>Tramos estancos.</strong> Todas las campañas de Publicidad
        comparten el mismo eje 0–100, así que dos tramos que no se solapan
        (0–50 y 50–100) parten el parque en dos compartimentos: nadie ve las
        dos. Es la forma de hacer un A/B en el que cada jugador está en un
        solo brazo. Si además quieres rebarajar <em>todas</em> las campañas de
        golpe, la <em>sal del reparto</em> (<code>audienceSalt</code>) de la
        sección lo hace; la sal de cada sobre solo rebaraja esa campaña.
      </p>
      <p>
        El panel de campañas (arriba del formulario de Publicidad) dibuja el
        eje con un carril por campaña y avisa de <em>huecos</em> (gente sin
        ninguna campaña viva), <em>solapes</em> (deciden las políticas, no el
        tramo) y <em>campañas tapadas</em> (con <code>order</code>, una
        anterior cubre todo su alcance: no se verá nunca).
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('cookbook', 'recipes')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="experimentos" class="ayuda__bloque">
      <h2>6. Experimentos A/B dentro de una campaña</h2>
      <p>
        Un experimento (<code>experiment</code>) contesta a «¿qué funciona
        mejor?» sin montar dos campañas: a cada jugador que <em>entra</em> en
        la campaña se le asigna una <strong>variante</strong> con nombre
        (<code>control</code>, <code>precioAlto</code>…), y la feature enseña
        una cosa u otra según ese nombre. Tiene una <strong>clave</strong>
        (<code>key</code>, en camelCase: <code>precioNavidad26</code>) y una
        lista de variantes, cada una con su <strong>peso</strong>. La primera
        suele ser el control.
      </p>

      <h3>Cómo se asigna</h3>
      <p>
        En un <em>segundo eje</em>, independiente del porcentaje de
        despliegue: que la rampa suba del 10 % al 50 % mete gente nueva pero
        <strong>no cambia la variante de nadie</strong> que ya estaba. La
        asignación es estable (el mismo jugador, la misma variante en cada
        arranque) y ponderada: la <strong>cuota esperada</strong> de cada
        variante es su peso dividido por la suma de pesos. Dos variantes con
        peso 1 son 50/50; pesos 3 y 1 son 75/25. Un peso 0 deja la variante
        definida pero sin nadie; si <strong>todos</strong> los pesos son 0,
        todo el mundo recibe la primera (quedarse sin variante sería un fallo
        mudo) y el panel de campañas lo avisa, igual que avisa de dos
        variantes con el mismo nombre.
      </p>
      <pre class="ayuda__ejemplo">experiment:
  key: precioNavidad26
  variants:
    - name: control      weight: 3     ← 75 %
    - name: precioAlto   weight: 1     ← 25 %</pre>

      <h3>Cómo lo lee la feature</h3>
      <p>
        El veredicto de cada evaluación lleva el nombre de la variante (y su
        cuota esperada); la feature decide con ese nombre qué precio, qué
        creatividad o qué texto enseña. Quien programa la feature tiene que
        conocer los nombres, así que <strong>acuerda los nombres antes de
        publicar</strong>: una variante que la feature no reconozca se
        comporta como lo que el programador haya dejado por defecto
        (normalmente, como el control). Sin experimento, la feature recibe
        una variante nula y hace lo de siempre.
      </p>

      <h3>No cambies la clave a mitad</h3>
      <p class="ayuda__aviso">
        ⚠️ La clave es la «sal» del reparto: cambiarla <strong>reasigna las
        variantes de todo el parque</strong>, y los datos de antes y de
        después ya no se pueden juntar. Tocar los pesos a mitad también mueve
        gente de una variante a otra, y renombrar una variante la cambia para
        la feature (el nombre es lo que lee). Si hay que medir algo nuevo, es
        un experimento nuevo con otra clave.
      </p>

      <h3>Cómo se mide</h3>
      <p>
        El evento <code>rollout.evaluated</code> lleva la variante asignada
        (<code>variant</code>) y su cuota esperada
        (<code>variant_share</code>). En Grafana, el panel «Campañas» tiene
        una sección <strong>Experimentos</strong> con el reparto observado por
        variante y una comprobación de <em>sample ratio mismatch</em> (SRM,
        chi-cuadrado): si la cuota observada se aleja de la esperada más de lo
        que explica el azar, el reparto está roto (un cliente viejo que no
        conoce el experimento, una variante que rompe el arranque, un cambio
        de clave a mitad) y los resultados no valen, por buenos que parezcan.
        <strong>Mira el SRM antes de mirar el resultado.</strong>
      </p>

      <h3>Cómo probar una variante concreta</h3>
      <p>
        En una build de desarrollo o beta: Ajustes → 7 toques sobre el número
        de versión → pestaña <strong>Rollout</strong>, y fuerza la
        <em>posición</em> (0–100). Con una posición forzada, la fracción del
        experimento es esa misma posición, así que «posición 12» cae siempre
        en la misma variante: con pesos 3 y 1, las posiciones 0–74 ven
        <code>control</code> y 75–99 ven <code>precioAlto</code>. El veredicto
        de la pestaña dice qué variante ha tocado. Desde el navegador, el
        endpoint <code>/evaluate</code> del Worker (sección 9) lo cuenta para
        cualquier identidad.
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('adr041', 'campaigns')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="capas" class="ayuda__bloque">
      <h2>7. Capas de exclusión mutua y punto del parque</h2>

      <h3>El problema</h3>
      <p>
        Cada sección tiene su propio eje: el punto de un jugador en
        Publicidad no tiene nada que ver con su punto en el Muro de pago (a
        propósito: así dos features no quedan correlacionadas por accidente).
        Eso está bien hasta que quieres que <em>no coincidan</em>: un anuncio
        de Navidad y un muro de Navidad, y que nadie vea los dos. Con ejes
        distintos, el 50 % del anuncio y el 50 % del muro se cruzan: la cuarta
        parte del parque ve ambos.
      </p>

      <h3>La capa (<code>cohort.layer</code>)</h3>
      <p>
        Poner la misma capa en dos campañas de secciones distintas hace que
        se sorteen <strong>sobre el mismo eje</strong>. Con tramos que no se
        solapan, cada jugador cae en una sola:
      </p>
      <pre class="ayuda__ejemplo">ads.banners[navidadAnuncio].rollout.cohort:
  layer: navidad26
  audience: { from: 0,  to: 50 }     ← mitad baja del eje «navidad26»

paywall.rollout.cohort:
  layer: navidad26
  audience: { from: 50, to: 100 }    ← mitad alta del MISMO eje</pre>
      <p>
        Quien cae en 0–50 ve el anuncio y nunca el muro; quien cae en 50–100,
        al revés. Si los tramos se solaparan (0–60 y 50–100), la franja común
        recibiría las dos y la capa no serviría de nada: el panel de campañas
        lo avisa, y dice con quién se comparte cada capa buscando en
        <em>todo</em> el JSON (también en las secciones que no son
        Publicidad). Una capa que solo usa una campaña no excluye a nadie:
        solo cambia su eje.
      </p>
      <ul>
        <li>
          Nombre en camelCase (<code>navidad26</code>), <strong>idéntico</strong>
          en todas las campañas que la comparten: una letra distinta es otra
          capa.
        </li>
        <li>
          <strong>La misma sal en todas.</strong> La sal del sobre entra en
          el sorteo: con sales distintas el eje ya no es el mismo aunque la
          capa lo sea. Lo más sencillo es dejarla vacía en las dos.
        </li>
        <li>
          El porcentaje y la rampa siguen siendo de cada campaña: la capa
          solo decide <em>sobre qué eje</em> se mide el punto del jugador.
        </li>
      </ul>

      <h3>Punto del parque por dispositivo o por cuenta (<code>cohort.bucketBy</code>)</h3>
      <p>
        El punto del parque se calcula a partir de una identidad.
        <code>device</code> (el valor por defecto) usa la identidad anónima
        del dispositivo, que siempre existe. <code>user</code> usa la cuenta
        del jugador: la misma persona cae en el mismo punto en su móvil y en
        su tablet, que es lo que quieres para un muro de pago o un
        experimento de precio (si no, podría ver dos precios). Sin sesión
        iniciada, <code>user</code> cae a <code>device</code>. Solo tiene
        efecto en juegos con cuentas; en uno que no las tiene (Snake, hoy)
        equivale siempre a <code>device</code>.
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('adr041', 'adr039', 'cookbook')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="ops" class="ayuda__bloque">
      <h2>8. La sección «Operación»: pánico, holdout y muestra</h2>
      <ul>
        <li>
          <strong>Pausar TODAS las campañas</strong>
          (<code>pauseCampaigns</code>): el botón de pánico. Encendido,
          ninguna campaña de ninguna sección llega a nadie —anuncios, muros,
          aviso de versión, profiling— porque cada sobre se evalúa como
          «pausado» antes que nada. No borra ni cambia nada: apagarlo lo
          devuelve todo tal cual estaba. Úsalo cuando algo va mal y no sabes
          todavía qué; después, arregla la campaña culpable y levanta la
          pausa.
        </li>
        <li>
          <strong>Motivo de la pausa</strong> (<code>pauseNote</code>): por
          qué y quién. Lo lee quien abra el dashboard sin contexto, y el
          panel de campañas lo enseña en rojo arriba del todo.
        </li>
        <li>
          <strong>Grupo de control global</strong>
          (<code>holdoutPercent</code>, de 0 a 100): un porcentaje del parque,
          estable por jugador y en un eje propio, que <strong>no recibe
          ninguna campaña de ninguna sección</strong> (motivo
          <code>holdout</code>): ni anuncios, ni muros, ni avisos de versión.
          Es la línea base para medir lo que las campañas aportan <em>en
          conjunto</em> (retención, ingresos): ese grupo contra el resto. 0 =
          sin holdout. <strong>Cambiarlo es empezar una medición nueva:</strong>
          al subirlo, gente que ya tenía campañas las pierde de golpe (y al
          bajarlo, gente del control empieza a verlas), así que los datos de
          antes y de después no se pueden comparar. Fíjalo al empezar a medir
          y no lo toques hasta terminar. El panel de campañas enseña una
          cinta mientras está activo.
        </li>
        <li>
          <strong>Muestra de exposición</strong>
          (<code>exposureSampleRate</code>, de 0 a 1): qué fracción de
          dispositivos envía el evento <code>rollout.evaluated</code>. 1 =
          todos. El muestreo es estable por dispositivo (el mismo siempre
          dentro o siempre fuera, para todas las secciones), así que bajarlo
          reduce volumen sin sesgar el alcance estimado. Con 0 te quedas
          ciego: no sabrás a cuánta gente llega nada, ni si un experimento
          reparte bien.
        </li>
      </ul>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('campaigns', 'adr040', 'adr041')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="comprobar" class="ayuda__bloque">
      <h2>9. Comprobar una campaña antes y después de publicar</h2>

      <h3>Antes</h3>
      <ol>
        <li>
          <strong>El panel de campañas</strong> de la pestaña Publicidad: sin
          avisos rojos (tramo vacío, alcance recortado por el porcentaje,
          calendario caducado o invertido, rampa que baja, segmento
          desconocido, país o idioma mal escrito, variante repetida, ids
          repetidos, campañas de más) y con los huecos que quieras tener, no
          otros. Si hay capa compartida, que los tramos sean estancos.
        </li>
        <li>
          <strong>El simulador de QA del juego</strong>, sin publicar nada:
          en una build de desarrollo o beta, Ajustes → 7 toques sobre el
          número de versión → pestaña <strong>«Rollout»</strong>. Ahí se ve el
          contexto real del dispositivo (posición, variante, versión, idioma,
          país, segmentos que cumple) y se puede <em>simular</em> otra
          posición, variante, versión, idioma, país o segmentos, y
          <em>forzar</em> «dentro» o «fuera» por sección. El veredicto dice
          por qué una campaña entra o no y, si hay experimento, qué variante
          le toca.
        </li>
        <li>
          <strong>El endpoint <code>/evaluate</code> del Worker</strong>,
          desde cualquier navegador y sin instalar nada: la misma URL de la
          que el juego lee el JSON, cambiando <code>.json</code> por
          <code>/evaluate</code> y añadiendo el contexto como parámetros:
          <pre class="ayuda__ejemplo">…/v1/{{ juego }}/{{ canal || 'prod' }}/evaluate?id=&lt;anonymousId&gt;&amp;variant=android&amp;formFactor=phone
    &amp;version=1.0.134&amp;locale=es-es&amp;country=ES&amp;segments=veterans,payers
    &amp;now=2026-12-24T10:00:00Z</pre>
          Devuelve el veredicto de <strong>todas</strong> las campañas del
          canal para ese contexto (permitida o no, motivo, posición,
          porcentaje efectivo, variante del experimento y su cuota esperada)
          con el <strong>mismo evaluador</strong> que el juego. Todos los
          parámetros son opcionales: sin <code>id</code> usa una identidad
          sintética (y lo dice: <code>syntheticIdentity</code>); sin
          <code>country</code> usa el país desde el que haces la petición,
          que es justo lo que verá un móvil de ese país
          (<code>countrySource</code> dice cuál se usó); sin <code>now</code>,
          ahora. Es la forma de contestar «¿qué ve este dispositivo?» pegando
          su <code>anonymousId</code>. Los sobres que no validan salen en
          <code>invalid</code>.
        </li>
        <li>
          <strong>Desde el repo principal</strong>, para un jugador concreto o
          para el parque entero:
          <pre class="ayuda__ejemplo">pnpm rollout:explain --game={{ juego }} --channel=prod --id=&lt;anonymousId&gt;
pnpm rollout:explain --game={{ juego }} --channel=prod --reach</pre>
          La primera explica campaña a campaña qué le tocaría a esa identidad
          y por qué; con <code>--reach</code> estima el alcance de cada
          campaña (qué parte del parque entra y por qué motivo se queda fuera
          el resto).
        </li>
        <li>
          Probar primero en <code>beta</code> con un dispositivo de pruebas,
          y pasar a <code>prod</code> (sección 10) cuando esté bien.
        </li>
      </ol>

      <h3>Después</h3>
      <ul>
        <li>
          <strong>Grafana → panel «Campañas»</strong>: el alcance observado,
          a partir del evento <code>rollout.evaluated</code> (sección, campaña,
          permitida o no, motivo del rechazo, porcentaje efectivo, posición,
          variante). Si la campaña preveía un 10 % y el panel enseña un 100 %,
          el targeting está roto; si enseña 0 %, algo la rechaza (el motivo lo
          dice). La sección <strong>Experimentos</strong> del mismo panel
          compara el reparto observado por variante con el esperado (SRM,
          sección 6). Recuerda que el volumen depende de la muestra de
          exposición.
        </li>
        <li>
          <strong>En el móvil</strong>: el diario de Ajustes → Ads (builds
          dev/beta) dice el veredicto de cada campaña y marca cuál ganó.
        </li>
        <li>
          El evento <code>rollout.evaluated</code> tiene que estar en la
          lista blanca de eventos de Analítica del canal; si no, es mudo y
          el panel sale vacío sin ningún error.
        </li>
      </ul>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('campaigns', 'cookbook', 'runbook', 'adr041')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="higiene" class="ayuda__bloque">
      <h2>10. Higiene: auditoría y diferencias entre canales</h2>
      <p>Tres comandos del repo principal:</p>
      <dl class="ayuda__comandos">
        <dt><code>pnpm remote-config:audit</code></dt>
        <dd>
          Revisa las campañas de los canales con su ficha: señala las
          <em>huérfanas</em> (sin nombre o responsable), las
          <em>caducadas</em> (calendario terminado pero encendidas) y las
          apagadas desde hace demasiado (por la fecha del último cambio).
          Pásalo de vez en cuando y antes de añadir campañas nuevas: con 20
          de tope, las muertas ocupan sitio.
        </dd>
        <dt><code>pnpm remote-config:diff --from=beta --to=prod</code></dt>
        <dd>
          Compara dos canales campo a campo y enseña lo que difiere. Es la
          forma de contestar «¿qué hay en beta que aún no está en prod?» sin
          leer dos JSON.
        </dd>
        <dt><code>pnpm remote-config:diff --from=beta --to=prod --promote</code></dt>
        <dd>
          Aplica al canal destino lo que difiere: lo probado en beta pasa a
          prod. Después hay que <strong>Publicar</strong> (o
          <code>pnpm publish:remote-config</code>), igual que con cualquier
          cambio. Revisa el diff antes: promociona <em>todo</em> lo que
          difiere, no solo la campaña que tenías en la cabeza.
        </dd>
      </dl>
      <p>
        Y la higiene manual: cada campaña con nombre y responsable en la
        ficha, la fecha del último cambio actualizada al tocarla, y las
        campañas que ya no hacen nada, borradas en vez de apagadas para
        siempre.
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('campaigns', 'adr040')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="modo-seguro" class="ayuda__bloque">
      <h2>11. El modo seguro del juego</h2>
      <p>
        Una configuración que rompe el arranque es el peor caso: el juego se
        cae antes de poder recibir el cambio que lo arregla. Por eso el juego
        lleva la cuenta de los arranques que no llegan a completarse con el
        mismo snapshot de configuración. Si un snapshot deja
        <strong>dos arranques seguidos sin completar</strong>, el siguiente
        arranca con los valores por defecto, pone ese snapshot en
        <em>cuarentena</em> y lo cuenta con el evento
        <code>remote_config.safe_mode.entered</code>.
      </p>
      <p><strong>Si salta:</strong></p>
      <ol>
        <li>
          Míralo en la analítica: el evento trae el identificador del snapshot
          y cuántos arranques fallaron. Si aparece en muchos dispositivos
          justo después de una publicación, la publicación es la sospechosa.
        </li>
        <li>
          Si no sabes qué campo fue, <strong>pausa todas las campañas</strong>
          (sección 8) y publica: es un snapshot nuevo, sale de la cuarentena
          y deja al juego estable mientras buscas.
        </li>
        <li>
          Arregla el campo culpable y publica. Un snapshot <em>distinto</em>
          que llega por red levanta la cuarentena; el mismo se sigue
          ignorando aunque vuelva, así que no sirve republicar lo mismo.
        </li>
        <li>
          Si los dispositivos en modo seguro siguen sin completar el arranque
          con los valores por defecto, el problema no es la configuración.
        </li>
      </ol>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('adr040', 'campaigns')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="next-boot" class="ayuda__bloque">
      <h2>12. Secciones que se aplican al siguiente arranque</h2>
      <p>
        Por defecto, un cambio publicado entra <em>en caliente</em>: el juego
        lo recibe y lo aplica al momento, que es lo que quieres de un
        kill-switch o de una campaña. Pero hay cosas que no deben cambiar a
        mitad de una partida (un parámetro de jugabilidad, la economía, un
        muro en curso). Quien define esas secciones las marca como
        «siguiente arranque», y el dashboard lo enseña con un chip morado en
        la cabecera de la sección: <em>se aplica al siguiente arranque</em>.
      </p>
      <p>
        Funciona así: cuando el juego termina de arrancar, congela el valor
        de esa sección; lo que llegue después se guarda y entra la próxima
        vez que el juego arranque. Para verlo en un dispositivo hay que
        cerrar la app del todo y volver a abrirla. Hoy ninguna sección de
        <code>{{ juego }}</code> está marcada así; si aparece el chip, ya
        sabes qué significa.
      </p>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('adr040', 'design')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="errores" class="ayuda__bloque">
      <h2>13. Errores típicos</h2>
      <table class="ayuda__tabla">
        <thead><tr><th>Qué pasa</th><th>Por qué</th><th>Qué hacer</th></tr></thead>
        <tbody>
          <tr>
            <td>La campaña no la ve nadie y el tramo «parece bien».</td>
            <td>
              Tramo invertido o vacío (desde ≥ hasta). El juego lo respeta a
              propósito: nadie.
            </td>
            <td>Corrige el tramo o bórralo (= todo el eje). El panel lo avisa.</td>
          </tr>
          <tr>
            <td>Tramo 50–100 y no entra nadie.</td>
            <td>
              El porcentaje (o la rampa) va por debajo de 50: recorta el eje
              desde el 0 y no llega al tramo.
            </td>
            <td>Sube el porcentaje por encima del inicio del tramo, o mueve el tramo.</td>
          </tr>
          <tr>
            <td>Pensabas excluir a todos con una lista vacía y sale en todas partes.</td>
            <td>
              <strong>Lista blanca vacía = todas</strong> (variantes, tipos de
              dispositivo). Vaciar no es prohibir.
            </td>
            <td>Para no salir en ningún sitio, apaga el interruptor.</td>
          </tr>
          <tr>
            <td>Un evento nuevo no aparece en ningún panel.</td>
            <td>
              No está en la lista blanca de eventos de Analítica: sale
              <strong>mudo</strong>, sin error. Pasa con
              <code>rollout.evaluated</code> igual que con cualquier otro.
            </td>
            <td>Añádelo a la lista blanca de los tres canales (y al juego) y publica.</td>
          </tr>
          <tr>
            <td>Gente que veía la campaña la ha perdido a mitad de un despliegue.</td>
            <td>Se cambió la sal (o el porcentaje bajó): rebaraja a todo el parque.</td>
            <td>No toques la sal en un despliegue por fases; fíjala por release.</td>
          </tr>
          <tr>
            <td>El calendario se cumple a horas distintas según el móvil.</td>
            <td>
              Un instante sin zona en un JSON editado a mano. El dashboard
              siempre guarda UTC con <code>Z</code>; a mano es fácil olvidarlo
              y el validador lo rechaza.
            </td>
            <td>Usa el selector de fecha del dashboard; comprueba la lectura UTC/local debajo.</td>
          </tr>
          <tr>
            <td>Guardé y el juego sigue igual.</td>
            <td><strong>Guardar no publica.</strong></td>
            <td>Publicar (y mirar la consola hasta el verde).</td>
          </tr>
          <tr>
            <td>Publiqué y el juego sigue igual.</td>
            <td>
              Estabas en otro canal (beta en vez de prod), o la campaña está
              en pausa global, o es una sección «siguiente arranque».
            </td>
            <td>Mira el canal de la barra, la pestaña Operación y el chip morado.</td>
          </tr>
          <tr>
            <td>Una campaña duplicada no sale nunca.</td>
            <td>Mismo id que otra: cooldown y cierre por sesión se guardan por id.</td>
            <td>Renómbrala. El panel lo avisa.</td>
          </tr>
          <tr>
            <td>El anuncio sale en blanco, sin error.</td>
            <td>
              La imagen está en un host que el navegador del juego bloquea
              (CSP). El validador rechaza URLs fuera de los orígenes
              permitidos; a mano se puede colar.
            </td>
            <td>Sube la imagen desde el selector de archivo del campo.</td>
          </tr>
          <tr>
            <td>Pulsé Purgar y no cambia nada.</td>
            <td>Purgar solo afecta a releases antiguas que leen jsDelivr, y su alias tarda hasta 12 h.</td>
            <td>Publicar ya desplegó el Worker; no hay nada que purgar para las apps actuales.</td>
          </tr>
          <tr>
            <td>Una campaña por país no la ve nadie.</td>
            <td>
              País en minúsculas (<code>es</code>): el servidor manda
              <code>ES</code> y no casa. O la prueba es en un primer arranque
              sin red: sin país conocido, una lista no vacía no deja entrar.
            </td>
            <td>
              Dos letras MAYÚSCULAS (el editor lo marca en rojo). Comprueba con
              <code>/evaluate?country=ES</code>.
            </td>
          </tr>
          <tr>
            <td>Quería «solo España» y sale en México.</td>
            <td>
              <code>es</code> es el idioma, no el país, y vale para cualquier
              <code>es-*</code>.
            </td>
            <td>
              Para el país, <code>countries: [ES]</code>; para el español de
              España, <code>es-es</code>.
            </td>
          </tr>
          <tr>
            <td>Los resultados del experimento cambiaron de repente.</td>
            <td>
              Se cambió la clave (o los pesos, o un nombre) a mitad: reasignó
              las variantes de todo el parque.
            </td>
            <td>
              No se deshace: clave nueva, medición nueva. Mira el SRM en
              Grafana antes de fiarte de nada.
            </td>
          </tr>
          <tr>
            <td>El anuncio y el muro «excluyentes» los ve la misma gente.</td>
            <td>
              Ejes distintos (sin capa), o misma capa con tramos que se pisan
              o con sales distintas.
            </td>
            <td>
              Misma capa, misma sal, tramos estancos (0–50 / 50–100). El panel
              lo avisa.
            </td>
          </tr>
          <tr>
            <td>Subí el holdout y gente perdió campañas que tenía.</td>
            <td>
              Es lo que hace: el grupo de control se amplía con gente que
              estaba dentro.
            </td>
            <td>
              Esperable. Fíjalo antes de empezar a medir y no lo toques hasta
              terminar.
            </td>
          </tr>
        </tbody>
      </table>
      <p class="profundizar">
        <span>Profundizar:</span>
        <a
          v-for="e in profundizar('guide', 'cookbook', 'campaigns')"
          :key="e.href" :href="e.href" target="_blank" rel="noopener noreferrer"
        >{{ e.texto }}</a>
      </p>
    </section>

    <!-- ───────────────────────────────────────────────────────────── -->
    <section id="enlaces" class="ayuda__bloque">
      <h2>14. Todos los enlaces</h2>
      <ul class="ayuda__enlaces">
        <li v-for="e in Object.values(ENLACES)" :key="e.href">
          <a :href="e.href" target="_blank" rel="noopener noreferrer">{{ e.texto }}</a>
          <code class="ayuda__ruta">{{ e.href.replace(DOCS, '') }}</code>
        </li>
      </ul>
      <p class="ayuda__nota">
        Los enlaces apuntan a la rama <code>dev</code> del repositorio
        principal.
      </p>
    </section>
  </article>
</template>

<style scoped>
.ayuda {
  max-width: 84ch;
  line-height: 1.6;
}
.ayuda__cabecera h1 { margin: 0 0 6px; font-size: 20px; }
.ayuda__intro { margin: 0 0 14px; color: var(--texto-tenue); }

.ayuda__indice {
  padding: 10px 14px;
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  background: var(--panel);
  margin-bottom: 22px;
}
.ayuda__indice ol { margin: 0; padding-left: 22px; columns: 2; column-gap: 24px; }
.ayuda__indice li { break-inside: avoid; font-size: 13px; }
.ayuda__indice a { color: var(--acento); text-decoration: none; }
.ayuda__indice a:hover { text-decoration: underline; }

.ayuda__bloque {
  padding: 4px 0 14px;
  border-bottom: 1px solid var(--borde-suave);
  margin-bottom: 18px;
  scroll-margin-top: 120px;
}
.ayuda__bloque h2 { font-size: 16px; margin: 8px 0 10px; }
.ayuda__bloque h3 { font-size: 13.5px; margin: 16px 0 4px; color: var(--acento); }
.ayuda__bloque p, .ayuda__bloque li { font-size: 13.5px; }
.ayuda__bloque p { margin: 0 0 10px; }
.ayuda__bloque ul, .ayuda__bloque ol { margin: 0 0 10px; padding-left: 22px; }
.ayuda__bloque li { margin-bottom: 4px; }
.ayuda__bloque code { font-size: 12px; background: var(--panel-alto); padding: 0 4px; border-radius: 3px; }

.ayuda__lista-inline { margin-right: 4px; }

.ayuda__tabla { width: 100%; border-collapse: collapse; font-size: 13px; margin: 0 0 10px; }
.ayuda__tabla th {
  text-align: left; font-weight: 600; color: var(--texto-tenue);
  border-bottom: 1px solid var(--borde); padding: 4px 8px;
}
.ayuda__tabla td { padding: 6px 8px; border-bottom: 1px solid var(--borde-suave); vertical-align: top; }

.ayuda__ejemplo {
  margin: 0 0 10px; padding: 8px 12px;
  background: var(--fondo); border: 1px solid var(--borde);
  border-radius: var(--radio);
  font-size: 12px; line-height: 1.5; overflow-x: auto;
}

.ayuda__aviso {
  padding: 8px 12px;
  border-left: 3px solid var(--aviso);
  background: #2a2112;
  border-radius: 0 var(--radio) var(--radio) 0;
}

.ayuda__segmentos { margin: 0 0 10px; }
.ayuda__segmentos dt { font-weight: 600; font-size: 13.5px; margin-top: 6px; }
.ayuda__segmentos dd { margin: 0 0 4px 0; font-size: 13px; color: var(--texto-tenue); }

.ayuda__comandos dt { margin-top: 8px; }
.ayuda__comandos dd { margin: 2px 0 6px; font-size: 13.5px; }

.ayuda__orden li { margin-bottom: 3px; }

.profundizar {
  margin: 12px 0 0 !important;
  padding: 6px 10px;
  font-size: 12.5px !important;
  border-left: 2px solid var(--morado);
  background: #1a1526;
  border-radius: 0 var(--radio) var(--radio) 0;
  display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline;
}
.profundizar span { color: var(--morado); font-weight: 600; }
.profundizar a { color: var(--acento); text-decoration: none; }
.profundizar a:hover { text-decoration: underline; }

.ayuda__enlaces { list-style: none; padding: 0 !important; }
.ayuda__enlaces li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.ayuda__enlaces a { color: var(--acento); text-decoration: none; }
.ayuda__enlaces a:hover { text-decoration: underline; }
.ayuda__ruta { font-size: 11px !important; color: var(--texto-debil); background: none !important; }

.ayuda__nota { color: var(--texto-debil); font-size: 12.5px !important; }
</style>
