# Changelog

## 0.7.2

- **Settings sections are now collapsible, collapsed by default**: Skills,
  Instructions, Custom Prompts, Connection, and Author Content each get
  their own chevron toggle, matching the main UI's segment pattern.
  Copilot Model stays always-visible (a single dropdown, not requested to
  collapse). Implementation note: the toggle behavior itself was already
  built for the main-body cards and the Token Usage footer -- rather than
  writing a third copy of the same click-handler logic, it's now one
  shared `wireToggles(container, rerender)` helper used by all three
  (main body, Settings, Token Usage), and a new `settingsSectionHtml()`
  mirrors `cardHtml()`'s collapse behavior with a lighter-weight header
  style suited to being nested inside an already-full-screen panel rather
  than stacking five bordered/shadowed cards.

## 0.7.1

- **Your Request and Response now share one font, one size, one line-height**
  (previously the response panel used a monospace editor font at 13.5px
  while the request textarea used the UI sans-serif font at a different
  size). Both now render at 16px with 1.65 line-height for easier reading.
- **Applied an Apple-style look throughout**: a `-apple-system,
  BlinkMacSystemFont, ...` font stack (resolves to San Francisco on
  macOS/iOS, falls back to Segoe UI Variable/Segoe UI elsewhere -- SF
  itself isn't licensable for web embedding, so this is the standard way
  sites match Apple's type feel cross-platform), tighter negative
  letter-spacing on headings, larger rounded corners on cards/buttons/
  inputs, subtle card shadows for depth, and smooth hover/press
  transitions on buttons.

## 0.7.0

- **Main UI simplified to four segments**: Workflow, Your Request, Response,
  and Token Usage. **Skills, Instructions, Custom Prompts, and the Copilot
  Model selector moved into Settings**, unified into one canonical model
  selector shared by both Send and Test Connection (previously two separate
  dropdowns could drift out of sync). The Workflow segment now shows a
  read-only "Model: X (change in Settings)" hint so the active model is
  never hidden.
- **Token Usage** is now collapsible/expandable like every other segment,
  collapsed by default.
- **Response segment now accumulates across the whole session** instead of
  being replaced on each send -- every new response is appended after a
  timestamped divider, and stays until the view or VS Code is closed. The
  segment badge now shows the response count; vertical scroll (already
  present) keeps a long scrollback navigable.
- Added a **copy button** on the Response segment that copies the entire
  accumulated response text to the clipboard, with an `execCommand`
  fallback if the async Clipboard API is unavailable.

## 0.6.0

- **Context budget now scales dynamically with the selected model, recomputed before every request.** Previously the attached-file/total character budgets were fixed config values regardless of which model was selected. Now the effective budget is derived from the selected model's real `maxInputTokens` (with a safety margin), so a bigger-context-window model genuinely lets more of an attached document through by design -- not just up to a fixed ceiling. `arsimTdsQe.maxAttachedFileContextChars` / `arsimTdsQe.maxTotalContextChars` remain as hard ceilings/fallbacks for very-large-window or window-size-unknown models.
- Added a real-token-accurate refinement pass: after an initial fast character-based estimate (~4 chars/token), the model's own tokenizer measures the actual cost, and if it came in over budget, the attached file is trimmed once more against the measured overage rather than trusting the estimate blindly.
- **Fixed a real ordering bug found while building this**: a large attached file on a small-context-window model could consume the *entire* budget, silently truncating the user's own request text to make room for it. The user's request is now always reserved first and protected from truncation; Skills/Instructions/an attached file only ever compete for what's left.
- Eliminated redundant token-counting: `buildContext()` now returns the token count it already computed while budgeting, reused directly for the "tokens sent" UI feedback and the Context Limit meter instead of counting a second time.
- Context summary now shows whether the budget used was model-scaled or the static config fallback, and the effective character ceiling applied, for transparency.
- Verified the new budgeting/refinement logic directly (not just by inspection) against a mocked `vscode` module covering: a small-window model with a tokenizer denser than the estimate (confirms convergence within budget and that the user's request is never dropped), an unknown-window model (confirms clean fallback with zero wasted tokenizer calls), and a large-window model with small content (confirms no unnecessary truncation).

## 0.5.1

- **Fixed: attached-file content was silently cut off at ~12,000
  characters on every request**, well before the actual model's context
  window (visualized live by the Context Limit bar) was anywhere close to
  full -- e.g. 2,233/12,078 tokens (18%) used, yet the file was still
  truncated. Root cause: `buildContext()` reused
  `arsimTdsQe.maxContextCharsPerFile` (default 12,000, sized for short
  Skill/Instruction `.md` files) as the cap for attached-file content too.
  Since the parsed file and selection don't change between requests, the
  same truncated prefix was sent every time -- content past that cutoff
  point was consistently unavailable to the model, which could read as
  "losing" previously-attached content on a later question even though
  the file was never actually detached.
- New setting `arsimTdsQe.maxAttachedFileContextChars` (default 200,000)
  now governs attached-file content specifically, separate from the
  Skill/Instruction per-file cap. `arsimTdsQe.maxTotalContextChars`
  (default raised 48,000 → 120,000) remains the real overall ceiling.
  If content still gets clipped, the existing "last line included" and
  Context Limit warning UI report it clearly.

## 0.5.0

- Raised the file-attach size limit from a fixed 25MB to a configurable
  **`arsimTdsQe.maxAttachFileSizeMB`, default 400MB**, covering
  `.docx`/`.pdf`/`.csv`/`.xlsx`/`.xls`/text files as requested. Lower it in
  Settings on memory-constrained machines.
- Avoided an unnecessary full-buffer copy when reading a picked file, which
  matters more now that attachments can legitimately be hundreds of MB.
- Attaching a file over 100MB now proactively suggests using "Control the
  data sent in the context" to narrow what's actually sent, rather than
  waiting for the Context Limit bar to show exceeded after the fact.
- **Known constraint, stated plainly**: the 400MB default is a file-size
  gate, not a memory guarantee. Parsing fully materializes a file's
  content as JS objects/strings in the extension host's single Node
  process -- for CSV/XLSX in particular, a large, densely-populated file
  can expand to significantly more memory than its on-disk size (each
  cell becomes its own JS string). Very large *and* very dense files may
  still stress available memory depending on the machine; PDFs are least
  affected since only extracted text (not embedded images) is retained.

## 0.4.4

- Split the combined "Your Request & Response" segment into two independent
  segments -- **Your Request** (input, Browse, Context Limit meter, Send)
  and **Response** (output, context summary) -- each with its own
  collapse/expand state, consistent with every other segment. Sending a
  request now auto-expands only the Response segment to reveal streaming,
  leaving Your Request exactly as you left it.

## 0.4.3

- Response panel is now drag-resizable in both directions (a resize handle
  at the bottom-right corner, same interaction as the native textareas
  elsewhere in the UI), on top of the existing Expand/Collapse toggle.
- Long unbreakable tokens (URLs, hashes, unbroken code lines) in the
  response are no longer force-hyphenated to fit -- they stay intact and
  reachable via a new horizontal scrollbar, while ordinary text still
  wraps normally.

## 0.4.2

- **Fixed: scanned/image-based PDFs (and other empty-content files) sent
  misleadingly "non-empty" content.** A page with no text still produced a
  `--- Page N ---` header, which passed the "is there anything to send"
  check even though there was no actual text underneath -- so the model
  received page markers with nothing between them and, reasonably,
  reported back that the file looked blank. Now: (1) each parser's output
  is checked for real content at attach time, and if a PDF/DOCX/CSV/XLSX/
  text file has little or nothing extractable, the UI shows an explicit
  warning right on the attached-file row *before* you send -- for scanned
  PDFs specifically, it explains that OCR (not implemented here) would be
  needed; (2) empty PDF pages are now sent as `(no extractable text on
  this page)` rather than silently blank, so even without the UI warning
  the model itself understands what it's looking at.

## 0.4.1

- **Fixed: PDF attach silently failed** (file never appeared as attached,
  no context sent, "Control the data..." link never showed). Root cause:
  pdfjs-dist's Node fallback resolves its worker script via a dynamic
  `require()` relative to its own file location, which breaks once esbuild
  bundles everything into one `dist/extension.js` -- the worker file no
  longer exists at the path it computes. Fixed in `src/fileIngest/pdfParser.ts`
  by pre-registering the worker's exports on `globalThis.pdfjsWorker`,
  which pdfjs checks before attempting that broken lookup. Verified against
  the actual bundled build output, not just the unbundled package (the gap
  that let this ship in 0.4.0 in the first place).
- Fixed: cancelling the Browse file dialog left the Browse button stuck
  disabled ("Parsing file…") for the rest of the session.
- Error toasts now stay visible longer (12s vs 4.5s) so failures like this
  are easier to actually notice.
- Context Limit bar now keeps a minimum visible width so its color is
  readable even at very low usage percentages.

## 0.4.0

- **Reset Session** now prompts for an admin password (native masked input)
  before clearing cumulative token totals. The password is a UI speed
  bump only, not real access control -- see `src/security/adminAuth.ts`.
- **File attach**: a "Browse…" button under Your Request opens a native
  file picker; the selected file (`.docx`, `.pdf`, `.csv`, `.xlsx`/`.xls`,
  or plain text) is parsed and its content is included alongside your
  prompt. A "Control the data sent in the context" panel lets you narrow
  exactly what's sent, auto-detected per file type: page range for
  PDF/DOCX (PDF page numbers are exact; DOCX is a clearly-labeled
  approximation, since Word doesn't store real page boundaries), column
  list + row range for CSV, and per-sheet column/row selection for Excel
  workbooks (sheets auto-detected via checkboxes). Tables inside
  `.docx`/`.pdf` files are included as extracted text.
- **Context Limit meter**: a thin, color-coded (green/amber/red) bar shows
  live usage against the selected model's real context window
  (`LanguageModelChat.maxInputTokens`). When exceeded, the UI names the
  last line of attached-file data that made it into the request and links
  straight to the Control panel.
- **Token Usage History** gained multi-filter search (workflow, model,
  host, date range, free text -- all combinable) and a **Download CSV**
  action that writes the currently filtered rows to your OS Downloads
  folder.
- UI overhaul: TD Bank green applied to headings, segment headers, links,
  icons, and primary/secondary buttons; base font sizes increased
  throughout; more breathing room between segments; all segments now
  collapsed by default for a clean landing view (fixed a latent bug where
  collapse state was silently lost on re-render); the Response panel and
  Custom Prompt editor both gained an explicit Expand toggle in addition
  to native textarea resize.

## 0.3.0

- Added durable **Token Usage History**: every chat request's token usage
  (sent, received, total, timestamp, workflow, model, local hostname) is
  now recorded in memory and flushed to a local JSON file under the
  extension's global storage directory immediately after each request
  completes (plus a best-effort final flush on shutdown). View it via the
  new "Token Usage History" link in the Token Usage footer -- a scrollable
  table with lifetime totals and a Clear History action.
- Added a "-- Select --" (`generic`) entry to the **Workflow to perform**
  dropdown, now the default selection. In this mode requests are sent with
  no workflow-specific output contract, so Skills/Instructions/Custom
  Prompts can be used standalone for general-purpose tasks.
- New setting `arsimTdsQe.maxTokenHistoryEntries` (default 2000) caps
  locally retained history size.

## 0.2.0

- Added a Token Usage panel pinned to the bottom of the sidebar view,
  showing sent (prompt), received (completion), and total tokens for the
  last request, plus cumulative session totals (persisted across VS Code
  restarts) with a Reset session action.
- Token counts come directly from the selected model's own tokenizer via
  `LanguageModelChat.countTokens`, not a generic estimate.
- Prompt token count now appears as soon as it's computed (before the
  model finishes responding), so users get immediate cost feedback.
- Test Connection (Settings) now also reports prompt/completion tokens
  for its probe request.
- Activity bar icon changed to a "TDS / QE / AI" text mark.

## 0.1.0

- Initial release: workflow-driven sidebar UI over the VS Code Language
  Model API, .github-sourced Skills/Instructions/Prompts, Settings panel
  with Test Connection, and step-by-step Skill/Instruction/Prompt wizards.
