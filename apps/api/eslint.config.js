import base from '@baseplate/config/eslint';

export default [
  ...base,
  {
    // The Prisma generated client is enormous, not human-authored, and
    // produces thousands of lint errors that are not ours to fix. Ignoring
    // it here keeps the type-aware lint fast and the output signal-to-noise
    // high. If a generated file ever needs to be reviewed, do it on a
    // separate PR with `--no-ignore` on the file specifically.
    ignores: ['generated/**', '**/generated/**'],
  },
];
