# Changelog

## 0.11.1

- **"Would you like to analyze a new story?" (Yes/No)** now appears automatically as a chat bubble right after a feature file is saved -- Yes jumps straight back to picking `jtmf.td.com`/`track.td.com` and a new ticket URL (username/password are reused from memory, never re-asked), No leaves a closing note and lets you keep asking follow-up questions about the current story. This loop continues for as long as you stay on the workflow, until you switch workflows in Settings or close VS Code.
- **Generated .feature output is now syntax-highlighted** in the chat, not just monospaced: `Feature`/`Background`/`Scenario`/`Scenario Outline`/`Examples` headers in green, `Given`/`When`/`Then`/`And`/`But` steps in blue, `@tags` in purple, `#` comments muted/italic, and `Examples:` data-table rows in orange -- rendered in its own bordered code-block panel so it reads like a real BDD file instead of plain chat text.

## 0.11.0

- **New workflow: "Generate Feature File From Jira Story"** -- fetches a Jira story from `jtmf.td.com` or `track.td.com`, splits its Acceptance Criteria into segments, and generates a Gherkin/BDD `.feature` file (Scenario/Scenario Outline + Examples, `@tag`ged with the ticket key, written from a senior-BA + senior-QE perspective), then saves it to a folder you choose and opens it.
- **The whole setup happens as a conversation in the chat itself**, exactly as specified: a bot bubble asks which site, then username, then a **masked** password field, then the ticket URL -- each answered by clicking a bubble option or typing in the normal compose box (which swaps to a real password input for that one step). Once fetched, a "Send data to LLM for feature file generation" bubble triggers the actual generation with no extra typing needed; after the file is generated another bubble prompts for the save folder and, once saved, a "🔁 Analyze another ticket" bubble lets you start over -- reusing the same site/credentials without asking again.
- **Credentials are held in memory only** -- never written to a file, never SecretStorage -- and are explicitly forgotten the moment you switch away from this workflow, per how this was scoped.
- **Linked tickets, HTML tables, and attachments are all pulled in automatically**: a `jtmf.td.com`/`track.td.com` URL found inside the Acceptance Criteria or Description is fetched too (one level deep); embedded wiki-markup tables are flattened cleanly instead of showing raw HTML; the latest version of any csv/xlsx/docx attachment is parsed and offered for inclusion (images are detected and skipped, with a toast telling you so).
- **Fine-grained control**: "Review / select context" opens a checklist of every Acceptance Criteria segment, the Description, any linked tickets, and any attachments -- check/uncheck what goes to the model. Attachments get their own page/row/sheet range controls, same as a regular Browse-picked file. The Context Limit meter (now living in the Token Usage footer) reflects exactly what's selected.
- **Auto-loaded, fully-editable persona, Skill, and Instruction** for this workflow, reachable via "Select Custom Prompt" / "Select Skill" / "Select Instruction", same mechanism as PROD Incident Analysis.
- Generated feature-file responses render in a monospace code block for readability.

## 0.10.1

- **The whole main UI now scrolls as one page** -- Chat, its compose controls, and the Token Usage footer flow together and scroll continuously (header stays pinned at the top) instead of the Chat segment being boxed into a separately-scrolling region that made everything feel cramped.
- **The Chat thread is a fixed 70% of the viewport height** with its own scrollbar -- a real chat app's message list, sized for maximum reading room, not "whatever space happened to be left."
- **MAL Codes / date range / Fetch Incidents are now one collapsible section**, collapsed by default -- once incidents are loaded, the form tucks away and only the result summary + "Review / select tickets" / "New incident search" links stay visible, keeping the compose area clean.
- **The Context Limit meter moved into the Token Usage footer**, independent of the Chat segment -- it's always visible there (even while Token Usage itself is collapsed) at the bottom of the UI, exactly where usage information belongs.
- **Fixed: incident-analysis table responses looked badly formatted.** The raw `| pipe | delimited |` markdown table text was being shown in the chat bubble *in addition to* the properly rendered table underneath it -- doubled, unreadable output for a few-hundred-row result. Now only the rendered table (plus any surrounding prose, like the "Key Observations" paragraph) is shown.
- **Larger, cleaner incident table typography** -- both the chat response tables and the Control panel's ticket-selection table use bigger text and more generous padding than the compact Token Usage History table, and wrap long text (Short Description, Recommendation, etc.) instead of clipping it.

## 0.10.0

- **PROD Incident Analysis is now a real ServiceNow-backed workflow**, not a paste-your-own-text workflow. Selecting it in Settings shows a MAL Codes field (comma-separated, auto-trimmed) and From/To date pickers right in the Chat compose area; "Fetch Incidents" queries ServiceNow's `incident` table (`cmdb_ci.u_application_code` IN the given codes, `sys_created_on` within the given range) and loads the results into the chat's context automatically -- the same way an attached file would, so you can keep asking follow-up questions against it without re-fetching.
- **Credential handling**: the ServiceNow username is a normal setting (`arsimTdsQe.serviceNowUsername`); the password is never written to any file (not a setting, not tsconfig.json) -- it's requested once via a native masked VS Code prompt and held in VS Code's encrypted SecretStorage. Use "ARSIM TDS QE: Forget ServiceNow Password" from the Command Palette to clear it (e.g. after a rotation).
- **Auto-loaded persona, Skill, and Instruction**: entering this workflow automatically selects a "senior production support engineer at a multinational bank" Custom Prompt, plus a Skill and Instruction encoding the incident root-cause taxonomy (OE/non-prod testing miss vs. technical/config issue vs. functional defect) and output rules -- all reachable and fully editable via "Select Custom Prompt" / "Select Skill" / "Select Instruction". Switching to a different workflow cleanly removes exactly these auto-added selections (never anything you picked yourself).
- **Skills and Instructions are now viewable and editable**, not just checkbox-toggleable -- click any skill/instruction's name in Settings to open the same inline editor Custom Prompts already had, with Expand/Collapse and Save.
- **"Control the data sent in the context"** now shows a scrollable, checkbox-selectable table of fetched incidents (ticket number, short description, severity) when the attached data came from ServiceNow, instead of the generic CSV column/row-range controls -- pick specific tickets once the full set no longer fits the Context Limit meter.
- **Chat responses get a real table** when the model answers a multi-incident question (its output contract requires one): rendered inline with severity-colour-coded badges (red/amber/yellow/green), plus a "Download as CSV" link. A row of suggested quick-reply questions ("Which of these are OE/non-prod testing misses?", etc.) appears under the response so you can tap instead of typing.
- **"🔎 New incident search"** clears the previously fetched incidents and search fields for a fresh MAL-code/date query, while leaving the auto-selected Custom Prompt/Skill/Instruction in place.
- **Switching workflows now resets the main view**: a fresh chat thread and no leftover attached file/incident search, so stale context from one workflow never bleeds into the next.
- **Compact Messenger-style send button**: "Send to Copilot" is now a small circular arrow button beside the textarea instead of a full-width button below everything.
- **The Chat segment now fills the full height** of the sidebar (down to the Token Usage footer) instead of sizing to its content.

## 0.9.2

- **Workflow moved into Settings.** The main view now shows only the Chat
  segment -- Workflow selection lives in Settings alongside the Copilot
  Model dropdown (both non-collapsible, since they're single controls
  changed less often than Skills/Instructions/Prompts). The Chat compose
  area now shows a compact "Workflow: X · Model: Y (change in Settings)"
  status line so the active selection is still visible without opening the
  overlay.
- **"Select Skill" / "Select Instruction" / "Select Custom Prompt" links**
  added beside the Browse button in the compose area. Clicking one opens
  Settings and jumps straight to (and expands) that specific section,
  instead of dropping the user on a generic Settings screen they'd have to
  scroll through. Whatever gets selected -- even mid-conversation, after
  several exchanges already happened -- is included automatically in the
  next request: selections are read live from state at send time, so no
  new plumbing was needed for this part.
- **Fixed: typing in the Chat request textarea kept losing cursor focus.**
  Root cause: every context-limit estimate (recomputed ~500ms after each
  pause in typing) was triggering a full re-render of the entire Chat
  segment, which destroys and recreates the DOM, including the focused
  textarea -- so the cursor silently dropped out and the user had to
  re-click into the box to keep typing. Fixed at the source: the context
  meter now updates via a small targeted DOM patch instead of a full
  re-render. As a second layer of protection, the general re-render path
  also now explicitly saves and restores focus/cursor position around any
  full rebuild, so this class of bug can't resurface from some other
  trigger later.

## 0.9.1

- **Enter to send**: pressing Enter in the chat textarea now sends the
  request, matching every standard chat app. Shift+Enter still inserts a
  newline; Enter is ignored mid-IME composition so it doesn't interfere
  with typing Japanese/Chinese/Korean via an input method. Added a small
  "Press Enter to send · Shift+Enter for a new line" hint under the
  textarea for discoverability.
- **Fixed a real bug found while making this change**: the empty-chat
  placeholder box ("Send a request below to start the conversation.") had
  a stray `//` sitting as literal text inside the template literal that
  built it -- not a real JS comment (template literals don't support
  those), so it would have rendered as garbled text on the page. Removed
  entirely, per request: an empty chat thread is now just a blank area. The
  "No messages yet" hint already shown in the toolbar above it made any
  in-panel placeholder text redundant anyway.
- **Removed the Expand/Collapse link** from the Chat segment -- the thread
  now always renders at its standard height (still drag-resizable from the
  corner, and still independently scrollable). The segment itself remains
  collapsed by default, as it already was.

## 0.9.0

- **"Your Request" and "Response" merged into one Chat segment** -- a real
  two-party conversation thread. Requests render as light-grey bubbles on
  the right, responses as light-green bubbles on the left, each with a
  small timestamp caption above it; the whole exchange history scrolls
  top-to-bottom inside the segment, with the compose bar (textarea,
  attach, Context Limit meter, Send) pinned below it so it's never scrolled
  out of reach.
- **Pulsing typing indicator**: three dots animate rhythmically in place of
  the response bubble from the moment a request is sent until its first
  token arrives, then swap seamlessly for the live, growing response --
  the same pattern used by Messenger, Slack, and every modern chat UI.
- **The compose box now clears itself after Send**, and your message
  appears in the thread immediately (optimistic UI), rather than waiting
  on the network round trip -- both standard chat-app behavior this
  extension didn't have before.
- Data model change to support this: `state.responses[]` (response-only
  entries) became `state.chatEntries[]` (one request+response *pair* per
  exchange, looked up by requestId in every streaming message handler
  rather than assumed to be "whichever is last" -- more correct, and ready
  for a future where more than one exchange could be in flight).
  Per-exchange context-summary details now render under that exchange's
  own response bubble instead of only the most recent one.
- **Robustness fix caught during implementation**: if a response errored
  out *after* partial text had already streamed in, the original logic
  would have discarded that partial text and shown only a generic error.
  Fixed -- partial content always stays visible in its bubble, with a
  small "Interrupted" note alongside it rather than replacing it.
- Copy button now exports the full conversation (both sides) as
  timestamped plain text.

## 0.8.0

- **Response segment restyled as Messenger-style chat bubbles.** Each
  response is now its own visually distinct bubble (very light green
  background, rounded corners with a small "tail" corner), separated from
  the next by clear spacing, with the date/time (plus workflow name) shown
  in small light-grey text just above each bubble. Required a real data
  model change: `state.responseText` (one accumulated string with text
  dividers) became `state.responses[]` (one entry per exchange), which is
  also what makes each bubble independently addressable in the DOM.
  Streaming still updates only the last bubble's text directly, not a
  full re-render, so typing speed stays independent of thread length.
  The Copy button now exports all bubbles as timestamped plain-text
  blocks. The plain-text Test Connection result in Settings is
  unaffected -- bubble styling is scoped to a `.chat-panel` modifier
  class used only by the Response segment's thread.

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
