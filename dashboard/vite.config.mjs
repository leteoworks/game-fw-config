import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// El servidor (`dashboard/server/index.mjs`) arranca Vite en modo middleware
// y le pasa este `root`, asi que aqui no hace falta configurar `server`: el
// puerto y el bind los decide el servidor, que es quien tambien sirve la API.
export default defineConfig({
  plugins: [vue()],
  // Herramienta local: los sourcemaps compensan de sobra el arranque.
  build: { sourcemap: true },
});
