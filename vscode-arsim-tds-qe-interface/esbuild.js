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

// Confluence importer's default sub-page recursion depth -- same
// "hardcoded in tsconfig.json, baked in as a define" pattern as the admin
// password above. See src/globals.d.ts and confluenceCredentials.ts.
const confluenceMaxDepth = Number(tsconfigRaw.confluence_max_depth ?? 3);

/**
 * Copies the repo's authored seed Skills/Instructions/Custom Prompts
 * (../.github/{skills,instructions,prompts} relative to this extension's
 * own folder) into resources/seed-github/ *inside* this extension's own
 * directory tree, fresh on every build. `.vscodeignore` doesn't exclude
 * resources/, so `vsce package` bundles whatever ends up here straight
 * into the .vsix -- making the packaged extension self-contained: every
 * user gets the curated Skills/Instructions/Prompts immediately, even in
 * a workspace (or with no workspace at all) that has no .github folder of
 * its own. See src/github/fileDiscovery.ts for how the extension merges
 * this bundled content with a user's own workspace .github/ files at
 * runtime (a workspace file always wins over a same-named bundled one --
 * editing a bundled item and saving creates that override).
 *
 * Runs on every `npm run compile` (and therefore every build script --
 * .ps1/.sh/.bat all call `npm run package`, which calls `npm run compile`
 * first) so the bundled snapshot is always in sync with whatever is
 * currently authored at the source location, with the copy logic living
 * in exactly one place instead of duplicated across three shell flavors.
 */
function copySeedGithubContent() {
  const kinds = ['skills', 'instructions', 'prompts'];
  const sourceRoot = path.join(__dirname, '..', '.github');
  const destRoot = path.join(__dirname, 'resources', 'seed-github');

  if (!fs.existsSync(sourceRoot)) {
    console.warn(`[seed-github] No source folder at ${sourceRoot} -- skipping (packaged .vsix will ship without bundled Skills/Instructions/Prompts).`);
    return;
  }

  let totalCopied = 0;
  for (const kind of kinds) {
    const sourceDir = path.join(sourceRoot, kind);
    const destDir = path.join(destRoot, kind);
    fs.rmSync(destDir, { recursive: true, force: true }); // fresh copy every build, no stale leftovers
    if (!fs.existsSync(sourceDir)) continue;

    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith('.md'));
    for (const name of files) {
      fs.copyFileSync(path.join(sourceDir, name), path.join(destDir, name));
    }
    totalCopied += files.length;
  }
  console.log(`[seed-github] Bundled ${totalCopied} seed file(s) from ${sourceRoot} into ${destRoot}.`);
}

/**
 * Same idea as copySeedGithubContent(), for the RAG Knowledge Base
 * feature: any `<repo root>/knowledge-base/*.json` gets bundled into the
 * .vsix as read-only "built-in" knowledge bases (see
 * src/knowledgeBase/knowledgeBaseStore.ts's 'bundled' tier). The
 * destination directory is always created even when empty, so the
 * extension's bundled-tier scan finds a real (if empty) directory rather
 * than having to treat "missing" as a special case.
 */
function copySeedKnowledgeBases() {
  const sourceDir = path.join(__dirname, '..', 'knowledge-base');
  const destDir = path.join(__dirname, 'resources', 'seed-knowledge-base');

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  if (!fs.existsSync(sourceDir)) {
    console.log('[seed-kb] No ../knowledge-base folder -- shipping with no built-in knowledge bases (users create their own).');
    return;
  }

  const files = fs.readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith('.json'));
  for (const name of files) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(destDir, name));
  }
  console.log(`[seed-kb] Bundled ${files.length} knowledge base(s) from ${sourceDir} into ${destDir}.`);
}

async function main() {
  copySeedGithubContent();
  copySeedKnowledgeBases();

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
      __CONFLUENCE_MAX_DEPTH__: JSON.stringify(confluenceMaxDepth),
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
