/**
 * Cliente de la API del dashboard.
 *
 * Todas las respuestas de error se propagan con su cuerpo: en una herramienta
 * de mantenimiento, el mensaje del servidor (o el stack) es exactamente lo
 * que hace falta ver, no un «algo ha fallado».
 */

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`/api${ruta}`, opciones);
  const texto = await res.text();
  let cuerpo;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(`Respuesta no-JSON de ${ruta}:\n${texto.slice(0, 500)}`);
  }
  // 422 es "no valida", que NO es un error de transporte: lo gestiona la UI
  // enseñando los errores sobre los campos culpables.
  if (!res.ok && res.status !== 422) {
    throw new Error(cuerpo?.error ?? `HTTP ${res.status} en ${ruta}`);
  }
  return cuerpo;
}

const conJson = (metodo, payload) => ({
  method: metodo,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload ?? {}),
});

export const api = {
  bootstrap: () => pedir('/bootstrap'),
  status: () => pedir('/status'),

  loadConfig: (game, channel) => pedir(`/config/${game}/${channel}`),
  saveConfig: (game, channel, data) => pedir(
    `/config/${game}/${channel}`, conJson('PUT', { data }),
  ),
  validateConfig: (game, data) => pedir(
    `/validate/${game}`, conJson('POST', { data }),
  ),

  publish: (message) => pedir('/publish', conJson('POST', { message })),
  deploy: () => pedir('/deploy', conJson('POST')),
  purge: (game) => pedir(`/purge/${game ?? ''}`, conJson('POST')),

  uploadAsset: async (game, file) => {
    const res = await fetch(`/api/assets/${game}`, {
      method: 'POST',
      headers: {
        // El nombre va en cabecera y el binario en el cuerpo: evita montar
        // un parser de multipart para subir UN fichero.
        'x-filename': encodeURIComponent(file.name),
        'content-type': 'application/octet-stream',
      },
      body: file,
    });
    return res.json();
  },
};
