// Re-export the shared config so `prettier .` at the repo root and the
// per-package configs can never disagree. One definition, one behaviour.
export { default } from '@baseplate/config/prettier';
