// The 'legacy' build is the Node-compatible entry point (no DOM/worker
// requirements) and is what a require()-based, single-file-bundled VS Code
// extension needs -- the modern build assumes a browser/worker environment.
// Pinned to pdfjs-dist@3.11.174 deliberately: v6+ requires Node >=22 and
// pulls in a native (@napi-rs/canvas) dependency neither of which is safe
// to assume inside VS Code's bundled extension host. v3.11.174 has no such
// requirements and still ships a clean CJS-requirable build.
import * as pdfWorkerEntry from 'pdfjs-dist/legacy/build/pdf.worker.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { ParsedPdfFile } from './parsedFile';

/**
 * pdfjs-dist's Node fallback ("fake worker", used when no real Worker is
 * available) resolves its own worker script via a *dynamic* `require()` of
 * a path relative to pdf.js's own file location. That resolution is only
 * valid when pdfjs-dist runs straight out of node_modules -- once esbuild
 * bundles everything into a single dist/extension.js, pdf.worker.js no
 * longer exists at the path pdfjs computes, and `getDocument()` rejects
 * with "Setting up fake worker failed". Confirmed by reproducing against
 * the actual bundled output, not just the unbundled package.
 *
 * The fix: pdfjs checks `globalThis.pdfjsWorker.WorkerMessageHandler`
 * *before* attempting that dynamic require. Pre-registering it here (a
 * static import, which esbuild resolves and bundles correctly) short-
 * circuits the broken path entirely. Must run before any `getDocument()` call.
 */
(globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorkerEntry;

export async function parsePdf(buffer: Buffer): Promise<ParsedPdfFile> {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    // Text extraction never needs glyph rendering, so we don't need real
    // standard-font metrics -- this just avoids a noisy console warning.
    disableFontFace: true,
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        pages.push(text);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return { kind: 'pdf', pages };
}
