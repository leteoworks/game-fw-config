/**
 * Conversion entre lo que se GUARDA (instante ISO 8601 en UTC) y lo que se
 * EDITA (un `<input type="datetime-local">`, que habla en la hora local del
 * navegador y sin zona).
 *
 * ## Por que el JSON lleva UTC con zona, siempre
 *
 * El calendario de una campaña y los escalones de su rampa los compara el
 * juego con la hora del SERVIDOR (no con la del dispositivo), y un instante
 * sin zona («2026-07-01T14:00») significa una cosa distinta en cada maquina
 * que lo lea. Por eso el schema exige zona (`Z` o `+hh:mm`) y aqui se
 * normaliza todo a UTC (`toISOString()`), que ademas es lo que el validador
 * acepta tal cual.
 *
 * El operador, en cambio, piensa en su hora local: el control se la enseña
 * y se la pide en local, y debajo se imprimen LAS DOS (la UTC guardada y su
 * equivalente local) para que «las 14:00» no se confundan con «las 14:00 Z».
 *
 * ## Modulo PURO
 *
 * Sin DOM: entra un string, sale un string. La zona horaria es la del
 * proceso (la del navegador en la UI; `process.env.TZ` en los tests).
 */

const pad = (n) => String(n).padStart(2, '0');

/** Milisegundos epoch de un ISO, o `null` si no es un instante legible. */
export function parseInstant(iso) {
  if (typeof iso !== 'string' || iso.trim() === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** ¿Es un instante ISO que el juego podra leer? */
export function isValidInstant(iso) {
  return parseInstant(iso) !== null;
}

/**
 * ISO (UTC) → valor para `<input type="datetime-local">` en hora LOCAL
 * (`YYYY-MM-DDTHH:mm`). Un valor ausente o ilegible → `''` (campo vacio).
 */
export function isoToLocalInput(iso) {
  const ms = parseInstant(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Valor del `datetime-local` (hora LOCAL, sin zona) → ISO en UTC.
 *
 * Devuelve `null` si el valor esta incompleto o no se puede interpretar: el
 * navegador entrega `''` mientras el usuario aun esta tecleando la fecha, y
 * escribir eso en el JSON dejaria un campo invalido a medio camino. Quien
 * llama debe NO escribir cuando recibe `null`.
 */
export function localInputToIso(local) {
  if (typeof local !== 'string') return null;
  const texto = local.trim();
  // El formato del control es fijo; cualquier otra cosa no viene de el.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto);
  if (!m) return null;
  const [y, mes, d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  if (mes < 1 || mes > 12 || h > 23 || min > 59 || s > 59) return null;
  // ⚠️ `Date` no rechaza un dia que no existe: «31 de febrero» se convierte
  // en silencio en el 3 de marzo. Se comprueba que el calendario devuelva el
  // mismo dia que se pidio (en UTC, para que el cambio de hora no estorbe).
  const dia = new Date(Date.UTC(y, mes - 1, d));
  if (dia.getUTCMonth() !== mes - 1 || dia.getUTCDate() !== d) return null;
  // Sin zona, `Date` interpreta los campos en la hora LOCAL del proceso, que
  // es exactamente lo que el control significa.
  const ms = new Date(y, mes - 1, d, h, min, s).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** `YYYY-MM-DD HH:mm UTC` del instante, para enseñar lo guardado. */
export function formatUtc(iso) {
  const ms = parseInstant(iso);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    + ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * El instante en hora local, con el nombre de la zona («14:00 CEST»).
 *
 * ⚠️ `dateStyle`/`timeStyle` no se pueden combinar con `timeZoneName` (el
 * motor lanza `TypeError: Invalid option`), asi que se piden los campos uno
 * a uno.
 */
export function formatLocal(iso, locale = 'es-ES') {
  const ms = parseInstant(iso);
  if (ms === null) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(new Date(ms));
}

/**
 * Las dos lecturas de un instante guardado, o `null` si no es legible.
 * Es lo que el control pinta debajo del campo.
 */
export function describeInstant(iso, locale = 'es-ES') {
  if (!isValidInstant(iso)) return null;
  return { utc: formatUtc(iso), local: formatLocal(iso, locale) };
}
