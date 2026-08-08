import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // '' as the prefix loads every variable, not just VITE_*, so the guard below
  // can tell "unset" apart from "set but not exposed to the client".
  const env = loadEnv(mode, process.cwd(), '');

  /**
   * FAIL THE BUILD LOUDLY when VITE_API_URL is missing.
   *
   * Vite inlines `import.meta.env.VITE_API_URL` at BUILD time. If it is unset,
   * the string `undefined` is baked into the bundle and every fetch resolves
   * against the page's own origin -- so the app "works" on a developer's
   * laptop (where the dev server proxies) and 404s in production. That failure
   * surfaces as a broken deploy, not as a broken build, which is the worst
   * possible place to find it.
   *
   * Only enforced for `build`. `vite dev` has a documented localhost default
   * (see below) because requiring an env file to run `make dev` is friction
   * with no safety payoff.
   */
  if (command === 'build' && !env.VITE_API_URL) {
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
      // 0.0.0.0 so the dev server is reachable from outside its container
      // when running `make dev`. Loopback-only would bind inside the container
      // and look like a network failure from the host.
      host: true,
      port: 5173,
      strictPort: true,
      watch: {
        // Docker bind mounts on Linux do not always propagate inotify events;
        // polling is slower but is the difference between hot reload working
        // and not working at all inside a container.
        usePolling: env.VITE_USE_POLLING === 'true',
      },
    },

    preview: { host: true, port: 4173, strictPort: true },

    build: {
      outDir: 'dist',
      // Source maps are shipped so a production stack trace is readable.
      // They expose your source; that is an accepted trade for a hackathon
      // demo and is called out in docs/adr/0007.
      sourcemap: true,
      target: 'es2022',
      rollupOptions: {
        output: {
          // Split React out of the app chunk: it changes far less often, so a
          // redeploy of app code leaves the vendor chunk cached in browsers.
          manualChunks: { react: ['react', 'react-dom'] },
        },
      },
    },
  };
});
