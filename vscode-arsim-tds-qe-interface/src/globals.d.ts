/**
 * Compile-time constant injected by esbuild's `define` (see esbuild.js).
 * Never read tsconfig.json at runtime -- this keeps the value out of the
 * packaged .vsix as a standalone file and avoids a rootDir violation
 * (tsconfig.json lives outside `src`).
 */
declare const __ADMIN_PASSWORD__: string;

/**
 * Default sub-page recursion depth for the Confluence importer, baked in
 * the same way (see tsconfig.json's `confluence_max_depth` and
 * esbuild.js). The `arsimTdsQe.confluenceMaxDepth` setting can override it
 * at runtime; `null` means "use this compiled-in value" -- see
 * src/confluence/confluenceCredentials.ts for why the setting can't just
 * declare this as its own default.
 */
declare const __CONFLUENCE_MAX_DEPTH__: number;
