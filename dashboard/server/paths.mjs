/**
 * Rutas del repo de config y del superproyecto.
 *
 * ## El acoplamiento, dicho en voz alta
 *
 * Este dashboard vive DENTRO de `game-fw-config`, que es un repo autonomo
 * (se clona solo, tiene su CI y su validador). Pero «Publicar» tiene que
 * hacer dos cosas: subir el JSON a git **y desplegar el Worker que lo sirve**
 * (ADR-038) — y el Worker vive en el SUPERPROYECTO
 * (`services/remote-config`), no aqui.
 *
 * Podria haberse evitado duplicando el Worker o moviendo el dashboard al
 * padre, pero las dos opciones son peores: duplicar deja dos verdades del
 * mismo despliegue, y mover el dashboard lo aleja de los datos que edita.
 *
 * Asi que el acoplamiento se ASUME y se hace explicito aqui: se detecta el
 * superproyecto por su forma (`<padre>/submodules/game-fw-config`) y, si no
 * aparece, las operaciones que lo necesitan fallan con un mensaje que dice
 * exactamente que falta. ❌ Lo que NO se hace es fallar a medias: publicar en
 * git y callar que el Worker no se desplego dejaria al usuario creyendo que
 * el cambio esta vivo cuando no lo esta.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Raiz del repo de configuracion (donde viven `v1/` y `schemas/`). */
export const CONFIG_ROOT = resolve(AQUI, '..', '..');

/** Carpeta de los JSON por juego y canal. */
export const V1_DIR = join(CONFIG_ROOT, 'v1');

/** Carpeta de los schemas por juego. */
export const SCHEMAS_DIR = join(CONFIG_ROOT, 'schemas');

/** Carpeta publica de assets (creativos de anuncios). */
export const ASSETS_DIR = join(V1_DIR, 'assets');

/**
 * Raiz del superproyecto, o `null` si el repo se esta usando suelto.
 *
 * Se comprueba que exista el Worker, no solo que la carpeta encaje: un
 * checkout del padre sin `services/remote-config` (una rama vieja) daria un
 * falso positivo y el fallo aparecería mucho mas tarde, al desplegar.
 */
export function findSuperproject() {
  const candidato = resolve(CONFIG_ROOT, '..', '..');
  const marcador = join(candidato, 'services', 'remote-config', 'wrangler.toml');
  return existsSync(marcador) ? candidato : null;
}

/** Explicacion de por que no se puede desplegar, para enseñarla tal cual. */
export const SIN_SUPERPROYECTO = [
  'No encuentro el superproyecto (my-game-fw).',
  '',
  'El JSON vive en este repo, pero el Worker que lo sirve vive en el',
  'proyecto padre (services/remote-config), asi que desde un clon suelto de',
  'game-fw-config se puede GUARDAR y hacer PUSH, pero no desplegar.',
  '',
  'Abre el dashboard desde el checkout del superproyecto:',
  '  <my-game-fw>/submodules/game-fw-config/dashboard',
].join('\n');
