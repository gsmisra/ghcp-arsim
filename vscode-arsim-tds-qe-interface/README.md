# ARSIM TDS QE GHCP Interface

An enterprise-grade VS Code extension that gives QE engineers a purpose-built
sidebar UI over GitHub Copilot's chat models -- no separate server, no
localhost bridge, no browser tab. It talks to Copilot through VS Code's
built-in `vscode.lm` Language Model API directly inside the extension host,
so requests are as fast as Copilot Chat itself.

## Features

- **Home view** (activity bar icon) titled **"ARSIM TDS QE GHCP Interface"**.
- **Workflow to perform** dropdown covering five workflows, each implemented
  as its own module under `src/workflows/`:
  - Test Case Creation (`testCaseCreation.ts`)
  - Automation Script Creation (`automationScriptCreation.ts`)
  - PR Analysis (`prAnalysis.ts`)
  - PROD Incident Analysis (`prodIncidentAnalysis.ts`)
  - Test Failure Analysis (`testFailureAnalysis.ts`)
- **Model picker** populated live from `vscode.lm.selectChatModels()` --
  whatever Copilot models are enabled for your account/org show up here.
- **Skills** and **Instructions** checklists, auto-discovered from
  `.github/skills/*.md` and `.github/instructions/*.instructions.md` in the
  open workspace. Only the files you tick are read and sent as context.
- **Custom Prompts**: pick a file from `.github/prompts/*.prompt.md`, view
  and edit its content inline, and save back to the same file or a new one.
- **Settings** panel (gear icon, top right):
  - **Test Connection** -- sends `Who are you ?` to the selected model and
    shows the raw response.
  - **Add New Skill / Add New Instruction / Add New Prompt** -- step-by-step
    ("Next ->") wizards that walk through every section of a comprehensive
    skill / instruction / prompt file and save it to the right `.github/`
    subfolder.

## Minimal, auditable context

`src/github/contextBuilder.ts` assembles exactly what is sent to the model:
only checked Skill/Instruction files, the selected prompt file (if any), and
the user's own request text -- nothing else. Empty sections are omitted
entirely (no "None selected" filler), and per-file / total character budgets
(`arsimTdsQe.maxContextCharsPerFile`, `arsimTdsQe.maxTotalContextChars`) cap
what can be sent, with any truncation surfaced back to the user in the
response panel's context summary.

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
