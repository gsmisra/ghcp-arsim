/**
 * Compile-time constant injected by esbuild's `define` (see esbuild.js).
 * Never read tsconfig.json at runtime -- this keeps the value out of the
 * packaged .vsix as a standalone file and avoids a rootDir violation
 * (tsconfig.json lives outside `src`).
 */
declare const __ADMIN_PASSWORD__: string;
