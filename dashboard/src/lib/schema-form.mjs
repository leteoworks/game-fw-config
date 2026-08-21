/**
 * Traduce el JSON Schema del juego a un MODELO DE FORMULARIO.
 *
 * ## Por que el schema pilota el formulario (y no una lista a mano)
 *
 * `schemas/<juego>.schema.json` ya es el contrato: declara los ~189 campos,
 * sus tipos, rangos, enums y descripciones, y lo valida el CI antes de
 * publicar. Un catalogo de campos escrito aparte seria una SEGUNDA verdad que
 * se desincronizaria al primer campo nuevo — y el sintoma seria el peor
 * posible: un campo que existe y el dashboard no deja tocar, o uno que el
 * dashboard ofrece y el validador rechaza al guardar.
 *
 * Asi que aqui NO hay lista de campos. Hay reglas para deducir el control
 * idoneo a partir de lo que el schema ya dice, mas un escape hatch (`x-ui`)
 * para lo que el schema no puede expresar (que un `string` es la URL de una
 * imagen y merece un selector de archivo con vista previa).
 *
 * ## Modulo PURO
 *
 * Sin DOM, sin red, sin fs: entra un schema y unos datos, sale un modelo.
 * Por eso se puede probar entero, que es lo que hace `schema-form.test.mjs`.
 */

/** Widgets que sabe pintar el formulario. */
export const WIDGETS = /** @type {const} */ ([
  'toggle',        // boolean
  'select',        // enum largo
  'radio',         // enum corto (<= 3)
  'text',          // string libre
  'textarea',      // string largo
  'url',           // string que es un enlace
  'version',       // string semver (o null)
  'datetime',      // instante ISO 8601 en UTC (o null); se edita en local
  'number',        // numerico sin rango acotado
  'range',         // numerico con min Y max
  'percent',       // 0..100 con sufijo %
  'duration',      // milisegundos, con ayuda legible
  'string-list',   // array de strings (editor de etiquetas)
  'object-list',   // array de objetos (tarjetas repetibles)
  'locale-map',    // objeto { es: '...', en: '...' }
  'object-map',    // objeto de clave libre → objeto ({ posthog: {...} })
  'asset-image',   // string que es la URL de una imagen
  'asset-video',   // string que es la URL de un video
  'unsupported',   // nada encaja: se edita como JSON crudo
]);

/** Nº de opciones a partir del cual un enum deja de ser radio y pasa a select. */
const MAX_RADIO_OPTIONS = 3;

/** Sufijos de nombre que delatan la unidad/semantica del campo. */
const SUFFIX_WIDGET = [
  [/Ms$/, 'duration'],
  [/Percent$/, 'percent'],
  [/^url$|Url$/, 'url'],
  [/^(min|max)Version$/, 'version'],
];

/**
 * Normaliza el `type` del schema, que puede venir como string o como lista
 * (`['string', 'null']` = el campo admite null explicito).
 *
 * Devuelve `{ types, nullable }` para que el resto razone con un solo tipo y
 * sepa aparte si el null es legal. Sin esto, un `['number','null']` no
 * casaria con ninguna regla y caeria a `unsupported` — justo los campos mas
 * delicados (`ttlMs`, `cooldownMs`, `skippableAfterMs`), donde ademas el null
 * SIGNIFICA algo distinto de 0.
 */
export function normalizeType(rawType) {
  const list = Array.isArray(rawType) ? rawType : [rawType];
  const types = list.filter((t) => t !== 'null');
  return { types, nullable: list.includes('null') };
}

/**
 * Colapsa `oneOf`/`anyOf` de la forma «null o X» a un schema plano.
 *
 * ⚠️ Sin esto, `analytics.eventPolicy.allowedEvents` —que es EXACTAMENTE la
 * allowlist de eventos, el campo mas delicado del fichero (ADR-030: un evento
 * que no este aqui se descarta EN SILENCIO)— no casaba con ninguna regla y
 * caia a «unsupported», o sea a editarse como JSON crudo. Justo el campo que
 * mas merece un editor decente.
 *
 * Se limita al caso «una rama null + una rama real», que es el unico que usa
 * este schema. Una union de verdad (string | number) no se puede pintar con
 * un solo control, y para esa se devuelve el schema tal cual → `unsupported`,
 * que es honesto.
 */
export function flattenSchema(schema) {
  const ramas = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(ramas)) return schema;

  const esNull = (s) => normalizeType(s.type).types.length === 0;
  const reales = ramas.filter((s) => !esNull(s));
  const admiteNull = ramas.some(esNull);
  if (reales.length !== 1) return schema;

  const { oneOf, anyOf, ...resto } = schema;
  const rama = reales[0];
  return {
    ...resto,
    ...rama,
    // El null de la rama se conserva en el `type` para que el control sepa
    // que «sin lista» es un valor legal y distinto de «lista vacia».
    type: admiteNull
      ? [...normalizeType(rama.type).types, 'null']
      : rama.type,
  };
}

/**
 * Decide el control de un campo.
 *
 * Orden de precedencia, de mas fuerte a mas debil:
 *  1. `x-ui.widget` explicito en el schema (lo que el schema no puede decir)
 *  2. `enum` (el conjunto cerrado manda sobre el tipo)
 *  3. el tipo
 *  4. el nombre del campo (sufijos de unidad)
 *
 * ⚠️ El nombre va el ULTIMO a proposito: es la senal mas fragil. Un campo que
 * se llamara `maxVersion` pero fuera un numero debe salir como numero.
 */
export function resolveWidget(key, rawSchema, metaWidget = null) {
  // El fichero de textos puede FORZAR el control: es donde se dice que
  // `ads.banners.images.url`, que para el schema es un string cualquiera, es
  // en realidad la URL de una imagen y merece selector de archivo y vista
  // previa. Sin esto se editaria a mano una URL que, si es incorrecta, deja
  // el anuncio en blanco sin ningun error.
  if (metaWidget) return metaWidget;

  const schema = flattenSchema(rawSchema);
  const ui = schema['x-ui'] ?? {};
  if (ui.widget) return ui.widget;

  if (Array.isArray(schema.enum)) {
    return schema.enum.length <= MAX_RADIO_OPTIONS ? 'radio' : 'select';
  }

  const { types } = normalizeType(schema.type);
  const type = types[0];

  if (type === 'boolean') return 'toggle';

  if (type === 'array') {
    const itemType = normalizeType(schema.items?.type).types[0];
    if (itemType === 'object' || schema.items?.properties) return 'object-list';
    return 'string-list';
  }

  if (type === 'object') {
    const sinPropiedades = !schema.properties
      || Object.keys(schema.properties).length === 0;
    if (sinPropiedades) {
      const valores = schema.additionalProperties;
      // Mapa abierto de STRINGS: en este schema siempre es "por idioma".
      if (valores?.type === 'string') return 'locale-map';
      // Mapa abierto de OBJETOS: `analytics.providers` (destino →
      // { enabled, batching }). ⚠️ Sin este caso caia a texto y se pintaba
      // como `[object Object]` — o sea que el kill-switch POR DESTINO de la
      // analitica no se podia tocar, que es de las cosas mas urgentes que
      // uno viene a hacer a este dashboard.
      if (valores?.type === 'object' || valores?.properties) return 'object-map';
    }
    return 'group';
  }

  // El nombre solo desempata DENTRO del tipo que ya se conoce.
  if (type === 'number' || type === 'integer') {
    for (const [re, widget] of SUFFIX_WIDGET) {
      if (re.test(key) && (widget === 'duration' || widget === 'percent')) {
        return widget;
      }
    }
    const tieneRango = typeof schema.minimum === 'number'
      && typeof schema.maximum === 'number';
    return tieneRango ? 'range' : 'number';
  }

  if (type === 'string') {
    for (const [re, widget] of SUFFIX_WIDGET) {
      if (re.test(key) && (widget === 'url' || widget === 'version')) {
        return widget;
      }
    }
    if (ui.multiline) return 'textarea';
    return 'text';
  }

  return 'unsupported';
}

/**
 * Busca los metadatos de UI de una ruta, admitiendo comodines.
 *
 * `paywall.overrides.*.triggers` cubre las OCHO plataformas de golpe. Sin
 * comodines habria que repetir el mismo texto ocho veces, y el dia que se
 * matizara una explicacion quedarian siete copias diciendo lo anterior — que
 * es peor que no tener ayuda, porque parece cierta.
 *
 * Gana la coincidencia mas ESPECIFICA: primero la exacta, y entre patrones,
 * el que tenga menos comodines. Asi se puede escribir la regla general y
 * matizar un caso concreto encima.
 */
export function lookupMeta(tabla, path) {
  if (!tabla) return {};
  if (tabla[path]) return tabla[path];

  const candidatos = Object.keys(tabla)
    .filter((k) => k.includes('*'))
    .filter((k) => {
      const re = new RegExp(`^${k.split('*').map(
        (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ).join('[^.]+')}$`);
      return re.test(path);
    })
    .sort((a, b) => {
      const cuenta = (s) => (s.match(/\*/g) ?? []).length;
      return cuenta(a) - cuenta(b) || b.length - a.length;
    });

  return candidatos.length > 0 ? tabla[candidatos[0]] : {};
}

/**
 * Ruta GENERICA: la misma sin los indices ni las claves de mapa.
 *
 * `ads.banners.0.images.1.url` → `ads.banners.images.url`
 *
 * Es la clave con la que se buscan etiqueta y descripcion, para que UNA
 * entrada valga para todos los elementos de una lista. Escribir la ayuda por
 * indice significaria que el banner #3 sale sin explicaciones.
 */
export function genericPath(path) {
  return path.split('.').filter((s) => !/^\d+$/.test(s)).join('.');
}

/** Lee un valor por ruta (`a.b.0.c`) devolviendo `undefined` si falta. */
export function readPath(obj, path) {
  if (path === '') return obj;
  let cursor = obj;
  for (const seg of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[seg];
  }
  return cursor;
}

/**
 * Escribe un valor por ruta, creando los contenedores que falten.
 *
 * Devuelve una copia: el modelo del formulario no muta los datos cargados, de
 * modo que "descartar cambios" sea volver a la copia original y no una
 * reconstruccion.
 */
export function writePath(obj, path, value) {
  const segs = path.split('.');
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  let cursor = copy;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i];
    const siguienteEsIndice = /^\d+$/.test(segs[i + 1]);
    const actual = cursor[seg];
    if (actual === undefined || actual === null) {
      cursor[seg] = siguienteEsIndice ? [] : {};
    } else {
      cursor[seg] = Array.isArray(actual) ? [...actual] : { ...actual };
    }
    cursor = cursor[seg];
  }
  cursor[segs[segs.length - 1]] = value;
  return copy;
}

/** Borra una ruta (volver a "sin definir"). Devuelve una copia. */
export function deletePath(obj, path) {
  const segs = path.split('.');
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  let cursor = copy;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const actual = cursor[segs[i]];
    if (actual === undefined || actual === null) return copy;
    cursor[segs[i]] = Array.isArray(actual) ? [...actual] : { ...actual };
    cursor = cursor[segs[i]];
  }
  if (Array.isArray(cursor)) cursor.splice(Number(segs.at(-1)), 1);
  else delete cursor[segs.at(-1)];
  return copy;
}

/** Etiqueta legible a partir de la clave (`cohortPercent` → `Cohort percent`). */
export function humanizeKey(key) {
  const conEspacios = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .toLowerCase();
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}

/**
 * Construye el modelo de un campo hoja.
 *
 * ⚠️ `present` (¿esta escrito en el JSON?) es distinto de "tiene valor". El
 * JSON solo lleva lo que se ha fijado a proposito; todo lo demas lo resuelve
 * el juego con su default. Confundirlos haria que abrir el dashboard y
 * guardar sin tocar nada MATERIALIZARA decenas de defaults en el fichero,
 * congelandolos: a partir de ahi, cambiar un default en el codigo del juego
 * ya no tendria efecto. Por eso un campo ausente se pinta como «sin definir»
 * y solo se escribe si se toca.
 */
function buildField({
  key, path, generic, schema: rawSchema, data, otherChannels, ui,
}) {
  const schema = flattenSchema(rawSchema);
  const value = readPath(data, path);
  const meta = lookupMeta(ui?.fields, generic);
  const { types, nullable } = normalizeType(schema.type);

  const diffs = {};
  for (const [canal, contenido] of Object.entries(otherChannels ?? {})) {
    const otro = readPath(contenido, path);
    // Se comparan serializados para que dos objetos/arrays equivalentes no
    // salgan como diferencia por ser instancias distintas.
    if (JSON.stringify(otro) !== JSON.stringify(value)) {
      diffs[canal] = otro;
    }
  }

  return {
    kind: 'field',
    key,
    path,
    generic,
    // El orden manda: la etiqueta en espanol del fichero de UI gana a la
    // clave humanizada, que es solo el ultimo recurso.
    // Tras el texto de UI y la pista `x-ui`, el `title` del contrato: los
    // schemas GENERADOS desde los contratos zod del juego traen titulo y
    // descripcion de cada campo, y `ui.json` queda para matizar.
    label: meta.label ?? schema['x-ui']?.label ?? schema.title ?? humanizeKey(key),
    // `help` es la explicacion DETALLADA en espanol (que hace el campo en el
    // juego); `description` es la del contrato, mas seca. Se enseñan las dos
    // cuando existen, porque dicen cosas distintas.
    description: meta.help ?? schema.description ?? null,
    contractNote: meta.help && schema.description ? schema.description : null,
    widget: resolveWidget(key, schema, meta.widget),
    types,
    nullable,
    value,
    present: value !== undefined,
    default: schema.default,
    enum: schema.enum ?? null,
    minimum: schema.minimum,
    maximum: schema.maximum,
    itemsSchema: schema.items ?? null,
    // Segmentos NOMBRADOS del juego (`x-segments`: nombre, titulo y que
    // significa cumplirlo). El `enum` de los elementos solo da los nombres;
    // sin esto el operador marcaria «veterans» sin saber que son «10
    // arranques», que es justo lo que decide si la campaña tiene sentido.
    segments: Array.isArray(schema['x-segments']) ? schema['x-segments'] : null,
    // Papel del campo dentro del sobre de despliegue (`x-rollout`), para que
    // el control pueda explicar la semantica (segmentos = cumplir TODOS).
    rolloutRole: schema['x-rollout'] ?? null,
    schema,
    diffs,
  };
}

/**
 * Construye el arbol de un objeto del schema: campos hoja y sub-grupos.
 *
 * Un `object` con `properties` es un GRUPO (se pinta como bloque con su
 * descripcion); cualquier otra cosa es una hoja.
 */
function buildNode({
  key, path, generic, schema: rawSchema, data, otherChannels, ui,
  isItemRoot = false,
}) {
  const schema = flattenSchema(rawSchema);
  const { types } = normalizeType(schema.type);
  const meta = {
    ...lookupMeta(ui?.sections, generic),
    ...lookupMeta(ui?.fields, generic),
  };
  const esGrupo = types[0] === 'object'
    && schema.properties
    && Object.keys(schema.properties).length > 0;

  if (!esGrupo) {
    return buildField({ key, path, generic, schema, data, otherChannels, ui });
  }

  const children = Object.entries(schema.properties).map(
    ([childKey, childSchema]) => buildNode({
      key: childKey,
      path: path ? `${path}.${childKey}` : childKey,
      generic: generic ? `${generic}.${childKey}` : childKey,
      schema: childSchema,
      data,
      otherChannels,
      ui,
    }),
  );

  return {
    kind: 'group',
    key,
    path,
    generic,
    isItemRoot,
    label: meta.label ?? schema.title ?? humanizeKey(key),
    description: meta.help ?? schema.description ?? null,
    contractNote: meta.help && schema.description ? schema.description : null,
    // El esquema del grupo, para que la cobertura de textos pueda mirar si el
    // contrato ya lo explica (los schemas generados traen title/description).
    schema,
    // Un grupo entero puede estar ausente del JSON (p.ej. `ads` en prod):
    // la UI lo dice y ofrece crearlo, en vez de pintar campos vacios que
    // parecerian definidos.
    present: readPath(data, path) !== undefined,
    children,
  };
}

/**
 * Construye el subarbol de UN elemento de una lista de objetos.
 *
 * Las listas (`ads.banners`, `images`, `preRollVideo.sources`) se editan como
 * tarjetas, y cada tarjeta necesita el mismo modelo que un grupo normal —
 * incluidas las descripciones y el estado «sin definir» de cada campo. Sin
 * esto habria que pintar los elementos de lista como JSON crudo, que es
 * justo lo que este dashboard viene a evitar: `ads.banners` es la parte con
 * mas campos delicados de todo el fichero.
 *
 * `index` entra en la ruta (`ads.banners.2.ttlMs`) para que escribir y borrar
 * usen el mismo mecanismo que cualquier otro campo.
 */
export function buildItemSubtree({
  itemsSchema, basePath, index, data, otherChannels = {}, ui = null,
  genericBase = null,
}) {
  const path = `${basePath}.${index}`;
  return buildNode({
    key: String(index),
    path,
    // El indice/clave NO entra en la ruta generica: la ayuda de un banner
    // vale para todos los banners.
    generic: genericBase ?? genericPath(basePath),
    ui,
    // La tarjeta ya pinta su propia cabecera con el indice o la clave, asi
    // que el nodo raiz del elemento no debe repetir el titulo de la lista.
    isItemRoot: true,
    // Se fuerza `type: object` porque un `items` puede declarar solo
    // `properties` sin `type`, y sin el se tomaria por una hoja.
    schema: { type: 'object', ...itemsSchema },
    data,
    otherChannels,
  });
}

/**
 * Modelo completo: una SECCION por cada propiedad de primer nivel.
 *
 * Cada seccion es una pestana de la UI. `schemaVersion` se excluye: no es
 * configuracion del juego sino el contrato del fichero, y dejarlo editable
 * invita a romper la validacion sin ganar nada.
 */
export function buildFormModel(
  schema,
  { data = {}, otherChannels = {}, ui = null } = {},
) {
  const props = schema.properties ?? {};
  const secciones = Object.entries(props)
    .filter(([key]) => key !== 'schemaVersion')
    .map(([key, sub]) => buildNode({
      key,
      path: key,
      generic: key,
      schema: sub,
      data,
      otherChannels,
      ui,
    }));

  return {
    sections: secciones,
    schemaVersion: readPath(data, 'schemaVersion') ?? null,
  };
}

/**
 * Plantilla de un elemento nuevo para un `object-list`.
 *
 * Solo siembra los campos REQUERIDOS y los que tengan `default`. Rellenar el
 * resto convertiria "anadir un banner" en materializar veinte defaults, con
 * el mismo problema que describe `buildField`.
 */
export function blankItem(itemsSchema) {
  const item = {};
  const props = itemsSchema?.properties ?? {};
  const requeridos = new Set(itemsSchema?.required ?? []);
  for (const [key, sub] of Object.entries(props)) {
    if (sub.default !== undefined) item[key] = sub.default;
    else if (requeridos.has(key)) item[key] = emptyValueFor(sub);
  }
  return item;
}

/** Valor vacio coherente con el tipo (para campos requeridos sin default). */
export function emptyValueFor(schema) {
  const { types } = normalizeType(schema.type);
  switch (types[0]) {
    case 'boolean': return false;
    case 'number':
    case 'integer': return typeof schema.minimum === 'number'
      ? schema.minimum
      : 0;
    case 'array': return [];
    case 'object': return {};
    default: return Array.isArray(schema.enum) ? schema.enum[0] : '';
  }
}
