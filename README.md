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
