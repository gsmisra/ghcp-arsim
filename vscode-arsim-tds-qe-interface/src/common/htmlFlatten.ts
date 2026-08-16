/**
 * Flattens HTML to plain text -- same technique as `flattenMammothHtml` in
 * src/fileIngest/docxParser.ts: table cells -> tab-separated, rows/block
 * elements -> newline-separated, every remaining tag stripped.
 *
 * A small hand-rolled flattener rather than a full HTML parser / new
 * dependency, because both producers it serves emit a narrow, predictable
 * vocabulary (p/div/table/tr/td/th/ul/li/br plus inline formatting):
 *   - Jira's `renderedFields` (wiki markup rendered to HTML)
 *   - Confluence's `body.storage` XHTML
 *
 * Confluence additionally emits `<ac:*>` / `<ri:*>` namespaced macro tags;
 * those are stripped by the same catch-all tag removal, which is the
 * desired behaviour -- macro *markup* is noise, while any text nested
 * inside a macro body survives.
 */
export function flattenHtml(html: string): string {
  let text = html;
  // Table cells -> tab-separated, rows -> newline-separated.
  text = text.replace(/<\/(td|th)>/gi, '\t');
  text = text.replace(/<\/tr>/gi, '\n');
  // Block-level elements -> newline-separated.
  text = text.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip every remaining tag (opening table/tr/td/ul/ol/inline formatting
  // tags, plus Confluence's ac:/ri: macro tags).
  text = text.replace(/<[^>]+>/g, '');
  // Decode the common entities both renderers emit.
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse trailing tabs per line and excess blank lines.
  text = text
    .split('\n')
    .map((line) => line.replace(/\t+$/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}
