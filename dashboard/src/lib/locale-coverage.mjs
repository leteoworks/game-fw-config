/**
 * Qué idiomas del juego se quedan sin texto propio en un mapa por idioma.
 *
 * Espejo de `resolve-message.ts` del repo principal (exacto → idioma base →
 * variante regional → inglés) y de `scripts/lib/app-update-locales.mjs`,
 * que hace la misma cuenta al publicar desde la terminal. Un idioma está
 * CUBIERTO si el texto le llega por alguno de los tres primeros pasos; si
 * solo le llega por el cuarto, lee el inglés — y eso, que una lista tipo
 * «en, zh-CN» no dice, es lo que el editor pone en voz alta: el jugador al
 * que le falta el suyo NO lee el texto genérico del juego en su idioma,
 * lee el INGLÉS publicado.
 */

/** `pt-BR` → `pt`; `zh-Hans-CN` → `zh`. */
const base = (locale) => {
  const guion = locale.indexOf('-');
  return guion === -1 ? locale : locale.slice(0, guion);
};

/**
 * Idiomas de `idiomas` (`[{ code, title }]`, los `x-locales` del schema) a
 * los que NINGUNA clave de `mapa` llega por exacto, base o variante.
 * Sin mayúsculas: `pt-BR`, `pt-br` y `pt` son el mismo idioma.
 */
export function idiomasSinTexto(idiomas, mapa) {
  const publicados = new Set(
    Object.keys(mapa ?? {}).map((k) => base(k.trim().toLowerCase())),
  );
  return (idiomas ?? []).filter(
    (l) => !publicados.has(base(String(l.code).toLowerCase())),
  );
}

/** ¿Hay texto en inglés (`en` o cualquier `en-*`), la reserva de todos? */
export function hayIngles(mapa) {
  return Object.keys(mapa ?? {}).some((k) => {
    const l = k.trim().toLowerCase();
    return l === 'en' || l.startsWith('en-');
  });
}
