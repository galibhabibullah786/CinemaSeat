/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl =
    env.VITE_API_URL ??
    env.VITE_API_BASE_URL ??
    process.env.VITE_API_URL ??
    process.env.VITE_API_BASE_URL;

  if (command === 'build' && !apiUrl) {
    throw new Error(
      [
        '',
        'VITE_API_URL is not set.',
        '',
        'It is inlined into the production bundle at build time, so an unset value',
        'silently ships an app that cannot reach its API. Refusing to build.',
        '',
        '  local:  cp .env.example .env      (then set VITE_API_URL)',
        '  docker: build arg VITE_API_URL    (see docker/Dockerfile.web)',
        '  CI:     set it in the workflow env for the docker-build job',
        '',
      ].join('\n'),
    );
  }

  return {
    plugins: [react()],

    server: {
      host: true,
      port: 5173,
      strictPort: true,
      watch: {
        usePolling: env.VITE_USE_POLLING === 'true',
      },
    },

    preview: { host: true, port: 4173, strictPort: true },

    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/__tests__/setup.ts',
      css: true,
    },

    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: { react: ['react', 'react-dom'] },
        },
      },
    },
  };
});
