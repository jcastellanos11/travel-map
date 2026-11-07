import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: '/',
  server: { host: '127.0.0.1', strictPort: true },
  build: {
    ...(mode === 'integration' ? { outDir: '.local/integration-dist' } : {}),
    rolldownOptions: { input: {
      demo: fileURLToPath(new URL('index.html', import.meta.url)),
      app: fileURLToPath(new URL('app.html', import.meta.url)),
      ...(mode === 'integration' ? { integration: fileURLToPath(new URL('integration.html', import.meta.url)) } : {}),
    } },
  },
}));
