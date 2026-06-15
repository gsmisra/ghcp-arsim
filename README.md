# GHCP QE Agentic Platform

Enterprise-ready QE generation platform for converting requirement sources into test artifacts.

## Supported Architecture

HTML UI
-> Flask Web App
-> VS Code Bridge Extension (localhost HTTP server)
-> VS Code Language Model API
-> GitHub Copilot (GHCP)
-> Generated BDD/Test Cases
-> Feature File Download

Only this architecture is supported.

## What It Automates
- Requirement intake from documents (`docx`, `xlsx`, `pdf`, `csv`)
- Requirement intake from Confluence (page + child pages + supported attachments)
- Requirement intake from Jira/JTMF stories (single or comma-separated IDs)
- Test case generation and BDD feature output
- Jira CSV generation
- Preview and download from the web UI

## Project Structure
- `ui/`: HTML/CSS/JS frontend
- `web_app.py`: Flask API and orchestration endpoints used by the UI
- `core-logic/`: readers, generation service, BDD/CSV output generators
- `vscode-ghcp-bridge-extension/`: localhost bridge extension using VS Code LM APIs
- `skills/`: skill markdown files selected by users
- `instructions/`: instruction markdown files selected by users
- `output/`: generated artifacts and logs

## Setup
1. Create and activate a Python environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Update `app_config.properties` base URLs/credentials as needed.

## Run
1. Start the bridge extension in VS Code:
   - Open `vscode-ghcp-bridge-extension/` as an extension project.
   - Press `F5` to launch Extension Development Host.
2. Ensure bridge health is available on `http://127.0.0.1:8765/health`.
3. Start Flask UI:
   - `python web_app.py`
4. Open `http://localhost:5050`.

`start.bat` can also launch startup checks and runtime flow.

## GHCP Bridge Configuration
The Flask backend calls the bridge HTTP API directly.

Relevant settings in `app_config.properties`:
- `GHCP_BRIDGE_BASE_URL`
- `GHCP_BRIDGE_AUTH_TOKEN`
- `GHCP_BRIDGE_TIMEOUT_SECONDS`
- `GHCP_BRIDGE_MAX_CASES`
- `GHCP_CONTEXT_WARN_CHARS`
- `GHCP_CONTEXT_MAX_CHARS`

## Validation and Safeguards
- Structured prompt sections are used for generation:
  - SYSTEM ROLE
  - OUTPUT CONTRACT
  - SELECTED SKILLS
  - SELECTED INSTRUCTIONS
  - REQUIREMENT CONTEXT
- Request context size guardrails:
  - warning threshold
  - hard max threshold with request rejection
- Bridge response validation:
  - must be JSON object with non-empty `test_cases`
  - required fields and types are validated
- BDD validation on save:
  - output must include `Feature:`
  - output must include `Scenario:` or `Scenario Outline:`

## Notes
- Generated files are stored in `output/`.
- Logs are written to `output/platform.log`.
- Use enterprise credential/secrets controls for production use.
