// Bundles the extension host code (src/extension.ts) into dist/extension.js.
// Kept dependency-free (esbuild only) so packaging stays fast and the shipped
// .vsix has no node_modules bloat -- this is what keeps activation lag-free.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production') || !watch;

// The admin password gate (Reset Session) is "hardcoded in tsconfig.json"
// per requirement: read here at build time and baked into the bundle as a
// literal constant via esbuild's `define`, so tsconfig.json itself never
// needs to ship inside the packaged .vsix. See src/security/adminAuth.ts.
const tsconfigPath = path.join(__dirname, 'tsconfig.json');
const tsconfigRaw = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
const adminPassword = String(tsconfigRaw.admin_password || '');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node16',
    format: 'cjs',
    // 'vscode' is provided by the extension host at runtime.
    // 'canvas' is an optional peer of pdfjs-dist used only for rendering
    // pages to a bitmap -- a code path this extension never calls (it only
    // extracts text via getTextContent()). Marking it external prevents
    // esbuild from failing to resolve a module that isn't installed and
    // isn't needed.
    external: ['vscode', 'canvas'],
    define: {
      __ADMIN_PASSWORD__: JSON.stringify(adminPassword),
    },
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
