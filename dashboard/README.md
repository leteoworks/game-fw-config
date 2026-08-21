# Dashboard de remote-config

Interfaz local para editar, guardar, publicar y purgar la configuración remota
de los juegos, sin tocar el JSON a mano.

```bash
pnpm install       # solo la primera vez
pnpm dashboard     # → http://127.0.0.1:7788
```

## Qué hace cada botón

| Botón | Qué hace | Alcance |
|---|---|---|
| **Guardar** | Valida contra el schema y escribe el JSON **en local**. Si no valida, no escribe nada y marca los campos culpables. | Tu disco |
| **Publicar** | `commit` → `pull --rebase` → `push` **y despliega el Worker**, verificando byte a byte contra la URL viva. | Builds actuales, al instante |
| **Desplegar** | Solo el Worker, sin tocar git. Útil para probar un cambio guardado antes de subirlo. | Builds actuales |
| **Purgar** | Purga la caché de jsDelivr. | **Solo releases antiguas** |

⚠️ **Publicar hace las dos cosas a propósito.** Desde
[ADR-038](../../../ADR-038-remote-config-worker.md) un `git push` a secas deja
el cambio en GitHub pero **no vivo**: quien lo diera por publicado se quedaría
esperando un efecto que no llega. Por eso van juntos, y si el despliegue falla
la operación termina en rojo — no en verde a medias.

⚠️ **Purgar es para otra población.** Las apps publicadas antes de ADR-038
llevan la URL de jsDelivr compilada dentro del bundle y siguen leyendo de allí.
Para ellas el retardo del alias `@main` (hasta 12 h) **no se puede evitar** ni
con la purga: es el motivo por el que existe el Worker.

Toda la salida de git, del despliegue y de la purga se ve **cruda** en el panel
inferior. Es deliberado: cuando un push falla, lo que resuelve el problema es el
mensaje de git tal cual, no un «ha fallado» nuestro.

## Cómo está montado

```
dashboard/
├── server/            Node: API, git, despliegue, purga, subida de assets
│   ├── index.mjs      un solo puerto: /api/** + Vite en middleware
│   ├── config-store   leer/escribir/validar los JSON
│   ├── ops.mjs        git · despliegue · purga (salida cruda)
│   ├── assets.mjs     imágenes → repo · vídeo → R2
│   └── paths.mjs      dónde está el repo de config y el superproyecto
└── src/
    ├── lib/schema-form.mjs       schema → modelo de formulario (PURO, con tests)
    ├── lib/datetime.mjs          UTC (JSON) ↔ hora local (pantalla) (PURO, con tests)
    ├── lib/campaign-status.mjs   estado de una campaña AHORA: calendario, rampa,
    │                             alcance real, segmentos, ficha (PURO, con tests)
    └── components/               un control por tipo de campo, el panel de
                                  campañas (AdsCampaignsPanel) y la Ayuda (HelpPanel)
```

### El formulario sale del schema, no de una lista

`schemas/<juego>.schema.json` ya declara los ~190 campos con sus tipos, rangos
y enums, y lo valida el CI. Así que aquí **no hay lista de campos**: hay reglas
que deducen el control idóneo de lo que el schema ya dice
(`src/lib/schema-form.mjs`). Un catálogo escrito aparte sería una segunda
verdad que se desincronizaría al primer campo nuevo, y el síntoma sería el peor
posible: un campo que existe y el dashboard no deja tocar, o uno que el
dashboard ofrece y el validador rechaza al guardar.

Los **textos en español** (etiquetas y explicaciones) sí viven aparte, en
`schemas/<juego>.ui.json`, porque son documentación de producto y cambian por
otros motivos que el contrato. La deriva entre ambos la caza un test:
`ui-coverage.test.mjs` se pone rojo con el nombre del campo delante si el
schema crece y los textos no.

### Fechas: UTC en el JSON, hora local en pantalla

El calendario de una campaña (`rollout.schedule`), los escalones de su rampa
(`rollout.cohort.ramp[].at`) y la ficha (`rollout.meta.updatedAt`) llevan en el
schema la pista `x-ui.widget: 'datetime'`. El control es un
`<input type="datetime-local">` que habla en la hora del operador; lo que se
**guarda** es siempre ISO 8601 en UTC (`2026-07-01T12:00:00.000Z`), porque el
juego compara esos instantes con la hora del **servidor**, no con la del
dispositivo, y un instante sin zona significa una cosa distinta en cada
máquina. Debajo del campo se leen las dos horas (la UTC guardada y su
equivalente local). Un valor incompleto o ilegible **no se escribe**; y ojo,
`Date` no rechaza «31 de febrero» (lo convierte en el 3 de marzo), así que la
conversión (`lib/datetime.mjs`) valida el calendario por su cuenta.

### El panel de campañas piensa en «ahora»

`AdsCampaignsPanel` calcula, con la misma semántica que el evaluador del juego
(`lib/campaign-status.mjs`), el estado de cada campaña en este instante:
**programada / activa / caducada / siempre** según el calendario, el escalón
vigente y el siguiente de la rampa, el **porcentaje efectivo**, los segmentos y
la ficha. El mapa del eje pinta el tramo declarado (contorno) y el **alcance
real** (sólido): el porcentaje recorta el eje desde el 0 y el tramo se aplica
encima, así que un tramo 50–100 con la rampa al 10 % no llega a nadie — y el
panel lo avisa, igual que avisa de calendarios caducados o invertidos, rampas
que bajan, segmentos que el juego no conoce (leídos del schema, que llega por
la prop `schema`) y fichas sin nombre o responsable. Si `ops.pauseCampaigns`
está encendido, sale un banner rojo arriba del panel y otro en la barra.

### Ayuda

La pestaña **Ayuda** (`HelpPanel`) explica, para un operador que no programa,
qué es cada cosa y cómo se opera una campaña: los botones, el sobre de
despliegue campo a campo (con las listas reales de variantes, dispositivos y
segmentos leídas del schema), el orden de evaluación, el reparto entre
campañas, la sección `ops`, cómo comprobar antes y después de publicar, la
higiene (`remote-config:audit`, `remote-config:diff`), el modo seguro,
`next-boot` y los errores típicos. Cada bloque enlaza a la referencia completa
en el repo principal.

### Las tres cosas que la UI no deja confundir

1. **«Sin definir» no es «apagado».** El JSON solo lleva lo que se ha fijado a
   propósito; el resto lo resuelve el juego con su default. Los campos ausentes
   salen atenuados, con su default a la vista, y **no se escriben hasta que se
   tocan**. Abrir y guardar sin tocar nada deja el fichero byte a byte igual —
   hay un test que lo fija. Si se materializaran los defaults, cambiar uno en el
   código del juego dejaría de tener efecto para siempre.
2. **`null` no es vacío ni 0.** En `ttlMs`, `null` es «no mostrar nunca» y `0`
   es «para siempre»: opuestos. Donde el schema admite `null` se ofrece como un
   estado con nombre, nunca como un campo en blanco.
3. **Este canal no es los otros.** Si un valor difiere de otro canal se dice al
   lado, porque el error típico es tocar `beta` creyendo que se toca `prod`.

## Assets

- **Imágenes** (`.svg .png .jpg .webp`) → `v1/assets/<juego>/` del repo. Viajan
  con el commit y se empaquetan en el Worker. Tope de 200 KB por pieza: el
  bundle entero no puede pasar de 700 KB.
- **Vídeo** (`.mp4 .webm`) → bucket **R2**. No cabe en el bundle ni debe engordar
  el repo. Se sirve por la misma URL (el Worker cae a R2 para lo que no tiene
  empaquetado) y **queda vivo sin desplegar**.

La URL la construye el servidor con el host de `REMOTE_CONFIG_URL`, el mismo que
inyecta el CSP. ⚠️ Si apuntara a otro host el navegador la bloquearía y el
anuncio saldría **en blanco sin ningún error**, ni en el juego ni en la consola.
Por eso el campo tiene vista previa: una imagen rota se ve rota.

## Esto es local y no lleva autenticación

El servidor escribe ficheros, hace `git push`, despliega un Worker y sube a R2,
**sin autenticación de ninguna clase**. La única frontera es que solo escucha en
`127.0.0.1`.

❌ **No cambies el bind a `0.0.0.0`** «para verlo desde el móvil»: cualquiera que
alcance el puerto puede publicar en producción. Si algún día hace falta acceso
remoto, lo que hay que añadir es autenticación, no abrir el bind.

## Dependencia del superproyecto

El dashboard vive en este repo, pero el Worker que sirve el JSON vive en
`my-game-fw/services/remote-config`. Desde un clon suelto de `game-fw-config` se
puede **guardar** y hacer **push**, pero no desplegar ni purgar; la UI lo dice
con un aviso en la barra superior en vez de fallar a medias.

El nombre del bucket de R2 y su jurisdicción se **leen de `wrangler.toml`** en
cada uso, en vez de estar fijados aquí: si vivieran en dos sitios acabarían
discrepando, y el síntoma sería una subida que responde OK contra un bucket que
el Worker no lee.

## Tests

```bash
pnpm test      # node --test, sin dependencias
```

Cubren la elección de control por tipo de campo, la garantía de que no se
materializan defaults, las rutas con comodines, la cobertura de textos y —el que
más costó— que **validar dos veces no reviente**: Ajv indexa los schemas por su
`$id`, así que sin caché de validadores el primer guardado funcionaba y todos
los siguientes fallaban con un error que no se parece en nada a su causa.
