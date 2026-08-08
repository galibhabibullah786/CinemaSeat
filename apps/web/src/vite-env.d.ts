/// <reference types="vite/client" />

/**
 * Types the environment Vite inlines at build time.
 *
 * Without this, `import.meta.env.VITE_API_URL` is `any` and a typo in the
 * variable name is invisible to the compiler -- which is exactly the bug this
 * whole file exists to prevent.
 *
 * Anything named VITE_* is PUBLIC: it ends up as a literal string in a
 * JavaScript file served to every visitor. Never put a secret here.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
