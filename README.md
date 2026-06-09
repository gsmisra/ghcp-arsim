# GHCP QE Agentic Platform

Enterprise-ready agentic application framework for QE teams to convert requirements into detailed test artifacts.

## What It Automates
- Requirement intake from:
  - Documents (`docx`, `xlsx`, `pdf`, `csv`)
  - Confluence (page + child pages + supported attachments recursively up to depth 5)
  - Jira/JTMF stories (single or comma-separated IDs)
- Test case generation to:
  - Detailed BDD feature files
  - Jira-importable CSV test cases

## Project Structure
- `core-logic/`: all reusable integration and generation components
- `ui/`: static HTML/CSS/JS UI (drag-and-drop enabled)
- `output/`: generated artifacts and logs
- `skills/`: predefined skill definition markdown
- `instructions/`: implementation and operation instructions

## Setup
1. Create and activate Python environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Update `app_config.properties` with base URLs and credentials (or set environment variables).

## Run CLI
- Double-click `start.bat` or run:
  - `python main.py --interactive`

## Run Web UI
- Double-click `start-ui.bat` or run:
  - `python web_app.py`
- Open `http://localhost:5050`

## Notes
- All generated files are stored in `output/`.
- Logging is written to `output/platform.log`.
- For production use in a bank, integrate with enterprise secrets manager and secure network controls.

## GHCP-Only Generation Mode
Current behavior before this update:
- The platform generated test cases using either semantic LLM API settings or local heuristic logic.
- It did not call a local VS Code GHCP extension instance directly.

Current behavior after this update:
- `DEFAULT_GENERATION_MODE=ghcp_bridge_strict` is enabled in `app_config.properties`.
- In strict mode, test case generation uses only the GHCP bridge command (`GHCP_BRIDGE_COMMAND`).
- No heuristic fallback is used in strict mode.

### Configure Local GHCP Bridge
1. Open `app_config.properties` and set `GHCP_BRIDGE_COMMAND`.
2. The command must accept placeholders:
  - `{prompt_file}` for input JSON
  - `{response_file}` for output JSON
3. Example command:
  - `powershell -ExecutionPolicy Bypass -File .\\scripts\\ghcp_bridge_example.ps1 -PromptFile "{prompt_file}" -ResponseFile "{response_file}"`

The bridge script is expected to:
- Read requirement context from `prompt_file` (document/confluence/jira content).
- Send that context to your local GHCP workflow in VS Code.
- Write strict JSON response to `response_file` with top-level `test_cases` array.

### Source Coverage for GHCP Input Context
- Document uploads: `docx`, `xlsx`, `pdf`, `csv`
- Confluence: page plus child pages and supported attachments
- Jira/JTMF: story fields + comments + supported attachments (`docx`, `xlsx`, `pdf`, `csv`)

### Output
- GHCP response is transformed into BDD feature output in `output/`.

## VS Code Extension Host Bridge (Automated Roundtrip)
This repository includes a local VS Code extension-hosted HTTP bridge:
- Extension folder: `vscode-ghcp-bridge-extension/`
- Python connector script: `scripts/ghcp_bridge_http.ps1`

### Quick Start
1. Open `vscode-ghcp-bridge-extension` as a VS Code extension project.
2. Press `F5` to launch an Extension Development Host.
3. In the Extension Development Host, confirm notification:
  - `GHCP bridge server listening on http://127.0.0.1:8765`
4. Keep that Extension Development Host window running.
5. Use configured command in `app_config.properties`:
  - `GHCP_BRIDGE_COMMAND=powershell -ExecutionPolicy Bypass -File .\\scripts\\ghcp_bridge_http.ps1 -PromptFile "{prompt_file}" -ResponseFile "{response_file}" -BridgeBaseUrl "http://127.0.0.1:8765"`

### Start Order Used By `start.bat`
1. Launch the GHCP bridge extension host first.
2. Wait for `http://127.0.0.1:8765/health` to report `ok`.
3. Launch the Flask UI.
4. The UI now retries bridge health automatically instead of failing immediately.

### Optional Security
- Set VS Code setting `ghcpBridge.authToken` in your user/workspace settings.
- Then append `-BridgeAuthToken "<token>"` to `GHCP_BRIDGE_COMMAND`.

### Bridge Adapter Hook
The extension server delegates generation to adapter command setting:
- VS Code setting: `ghcpBridge.adapterCommand`
- Required placeholders:
  - `{request_file}`
  - `{response_file}`

You can start with:
- `powershell -ExecutionPolicy Bypass -File <repo>\\scripts\\ghcp_bridge_example.ps1 -PromptFile "{request_file}" -ResponseFile "{response_file}"`

Then replace that adapter with your actual GHCP extension automation command.

### Default Bridge Behavior
- If `ghcpBridge.adapterCommand` is empty, the extension bridge now uses the VS Code language model API directly.
- This is the recommended mode because it avoids brittle window automation and removes the connection-refused failure you saw.
- The PowerShell chat-window template in `scripts/ghcp_bridge_example.ps1` is now an optional fallback for teams that still want UI automation.
