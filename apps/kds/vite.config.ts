import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  // @omnibite/shared is a CommonJS workspace package; Vite skips pre-bundling
  // linked workspace deps by default, which leaves the browser unable to resolve
  // its named exports (e.g. `Events`) and blanks the app. Force it to be
  // pre-bundled so the CJS->ESM named exports are available.
  optimizeDeps: { include: ['@omnibite/shared'] },
});
