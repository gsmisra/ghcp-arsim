// Bundles the extension host code (src/extension.ts) into dist/extension.js.
// Kept dependency-free (esbuild only) so packaging stays fast and the shipped
// .vsix has no node_modules bloat -- this is what keeps activation lag-free.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production') || !watch;

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node16',
    format: 'cjs',
    external: ['vscode'],
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
