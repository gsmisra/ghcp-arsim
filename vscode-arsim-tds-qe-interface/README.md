# ARSIM TDS QE GHCP Interface

An enterprise-grade VS Code extension that gives QE engineers a purpose-built
sidebar UI over GitHub Copilot's chat models -- no separate server, no
localhost bridge, no browser tab. It talks to Copilot through VS Code's
built-in `vscode.lm` Language Model API directly inside the extension host,
so requests are as fast as Copilot Chat itself.

## Features

The main view is deliberately minimal -- four collapsible segments (all
collapsed by default):

- **Workflow** -- the "Workflow to perform" dropdown, defaulting to
  **"-- Select --"** (`src/workflows/generic.ts`) -- a general-purpose mode
  with no fixed output contract, so Skills/Instructions/a Custom Prompt can
  be used on their own for ad hoc requests -- plus five task-specific
  workflows, each implemented as its own module under `src/workflows/`:
  - Test Case Creation (`testCaseCreation.ts`)
  - Automation Script Creation (`automationScriptCreation.ts`)
  - PR Analysis (`prAnalysis.ts`)
  - PROD Incident Analysis (`prodIncidentAnalysis.ts`)
  - Test Failure Analysis (`testFailureAnalysis.ts`)

  This segment also shows a read-only hint naming the currently selected
  Copilot model, with a link into Settings to change it.
- **Your Request** -- the prompt textarea, Browse/attach, and the Context
  Limit meter.
- **Response** -- accumulates every response for the session (new replies
  are appended after a timestamped divider, not replacing the previous
  one) until the view or VS Code closes. Has its own Expand/Collapse toggle,
  drag-resize, vertical/horizontal scroll, and a copy-to-clipboard button.
- **Token Usage** -- the sticky footer described below.

Everything else lives in **Settings** (gear icon, top right):

- **Copilot Model** -- one canonical model picker (populated live from
  `vscode.lm.selectChatModels()`) shared by both Send and Test Connection,
  so they can't drift out of sync.
- **Skills** and **Instructions** checklists, auto-discovered from
  `.github/skills/*.md` and `.github/instructions/*.instructions.md` in the
  open workspace. Only the files you tick are read and sent as context.
- **Custom Prompts**: pick a file from `.github/prompts/*.prompt.md`, view
  and edit its content inline, and save back to the same file or a new one.
- **Connection** -- **Test Connection** sends `Who are you ?` to the
  selected model and shows the raw response.
- **Author Content** -- **Add New Skill / Add New Instruction / Add New
  Prompt** step-by-step ("Next ->") wizards that walk through every section
  of a comprehensive skill / instruction / prompt file and save it to the
  right `.github/` subfolder.

## Token usage tracking

Every request's prompt/completion token counts (from the selected model's
own tokenizer, via `LanguageModelChat.countTokens`) are shown live in a
sticky, collapsible footer panel (collapsed by default), alongside a
running session total. A **"Token Usage History"** link opens the full,
durable log -- one entry per request, with
timestamp, workflow, model, sent/received/total tokens, and the local
hostname -- persisted to a JSON file under the extension's global storage
directory (`src/telemetry/tokenHistoryStore.ts`). Entries are flushed to
disk immediately after each request (not only on shutdown), so the log
survives crashes or a forced window close, not just clean exits.

## Attaching a file to a request

Click **Browse…** under Your Request to pick a `.docx`, `.pdf`, `.csv`,
`.xlsx`/`.xls`, or plain text file via VS Code's native file picker
(`src/fileIngest/`). The file is parsed once in the extension host and its
content is included alongside your prompt. Files up to
`arsimTdsQe.maxAttachFileSizeMB` (default **400MB**) are accepted; parsing
fully loads the file into memory, so on memory-constrained machines it's
worth lowering this setting. **Control the data sent in the
context** opens a panel with controls auto-selected by detected type:

- **PDF** -- exact page range (PDFs store real page boundaries).
- **DOCX** -- an approximate page range, clearly labeled as such: `.docx`
  files don't store fixed page numbers (Word computes pagination at
  print/display time), so this divides the text evenly across detected
  manual page-break markers. Tables in both PDF and DOCX are included as
  extracted/flattened text.
- **CSV** -- comma-separated column list plus a row range.
- **Excel** -- auto-detected sheet names as checkboxes, each with its own
  column list and row range.

A thin **Context Limit** bar (green → amber → red) tracks live usage
against the selected model's real context window
(`LanguageModelChat.maxInputTokens`), debounced so it doesn't fire on every
keystroke. If the budget is exceeded, the UI names the exact last line of
attached-file content that made it into the request.

## Minimal, auditable context

`src/github/contextBuilder.ts` assembles exactly what is sent to the model:
only checked Skill/Instruction files, the selected prompt file (if any), an
attached file (if any), and the user's own request text -- nothing else.
Empty sections are omitted entirely (no "None selected" filler).

The user's own request text is always reserved first and never truncated to
make room for anything else (Skills/Instructions/an attached file exist to
*support* answering it, not compete with it).

**The context budget scales with the selected model, recomputed on every
request.** Rather than a fixed character ceiling, the effective budget for
the attached file and the total request is derived from the selected
model's real `LanguageModelChat.maxInputTokens` (with a safety margin for
tokenizer-estimate slack), so switching to a model with a larger context
window genuinely lets more of an attached document through -- not just up
to some fixed number. A first pass sizes content using a standard
chars-per-token estimate; if the model's own tokenizer (via `countTokens`)
reports the real count came in over budget, the attached file is re-trimmed
once more against the measured overage. `arsimTdsQe.maxContextCharsPerFile`
(Skill/Instruction files only), `arsimTdsQe.maxAttachedFileContextChars`,
and `arsimTdsQe.maxTotalContextChars` remain as hard ceilings/fallbacks --
they bind only when a model's window is very large or doesn't report a
window size at all. Any truncation is surfaced back to the user in the
response panel's context summary, including which budget source (model vs.
config) was used.

## Compatibility

`engines.vscode` is `^1.85.0` so the extension activates and renders its UI
on older VS Code releases too. The Copilot-specific features depend on the
`vscode.lm` API (stable since VS Code 1.90); on older hosts those actions
fail with a clear, actionable message instead of a silent error or crash --
see `src/copilot/copilotClient.ts`.

## Development

```bash
npm install
npm run watch   # esbuild in watch mode
```

Press `F5` in VS Code (with this folder open) to launch an Extension
Development Host.

## Packaging

From the repository root:

```bash
./build-extension.ps1     # Windows PowerShell
./build-extension.sh      # macOS/Linux
```

Both produce a single installable `.vsix` file. See the repository root
README for details.
