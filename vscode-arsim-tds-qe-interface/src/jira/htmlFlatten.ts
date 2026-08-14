/**
 * Flattens Jira's `renderedFields` HTML (wiki-markup rendered to HTML) to
 * plain text, same technique as `flattenMammothHtml` in
 * src/fileIngest/docxParser.ts: table cells -> tab-separated, rows/block
 * elements -> newline-separated, every remaining tag stripped. A small
 * hand-rolled flattener rather than a full HTML parser/new dependency --
 * Jira's rendered output vocabulary (p/table/tr/td/th/ul/li/br plus inline
 * formatting) is as narrow and predictable as mammoth's.
 */
export function flattenJiraHtml(html: string): string {
  let text = html;
  // Table cells -> tab-separated, rows -> newline-separated.
  text = text.replace(/<\/(td|th)>/gi, '\t');
  text = text.replace(/<\/tr>/gi, '\n');
  // Block-level elements -> newline-separated.
  text = text.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip every remaining tag (opening table/tr/td/ul/ol/inline formatting tags).
  text = text.replace(/<[^>]+>/g, '');
  // Decode the common entities Jira's renderer emits.
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
