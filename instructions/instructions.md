# GHCP QE Agentic Platform Instructions

## Objective
Deliver an enterprise-grade quality engineering agentic platform for requirement-to-testcase acceleration across banking delivery teams.

## Runtime Modes
1. CLI Mode:
- Run `start.bat`
- User prompted for source type (`a`, `b`, `c`)
- User prompted for output type (Jira CSV or BDD)
- Generated outputs written to `output`

2. Web Mode:
- Run `start-ui.bat`
- Open `http://localhost:5050`
- Upload document or submit Confluence/Jira input
- Download/use generated artifacts from `output`

## Source-Specific Flow
### A) Document
1. Prompt user for file type (`docx`, `xlsx`, `pdf`, `csv`)
2. Validate selected type against extension
3. Parse file with `DocumentReader`
4. Generate output format selected by user

### B) Confluence
1. Accept URL or page ID
2. Extract page ID
3. Recursively process child pages up to depth 5
4. Read supported attachments recursively per page
5. Generate selected output format

### C) Jira / JTMF
1. Accept single story ID or comma-separated list
2. For each story call Jira REST API
3. Extract key fields and comments
4. Flatten ADF content
5. Generate selected output format per story

## Security and Bank Readiness
- Use API token auth for Jira/Confluence integrations.
- Do not hardcode secrets in source code.
- Keep credentials in environment variables or secured deployment secrets.
- Keep TLS verification enabled in production.
- Ensure PII is masked before requirement ingestion.
- Store logs and generated outputs in controlled access directories.

## Modular Design Contract
- External data capture/parsing modules must remain inside `core-logic`.
- Generation logic remains independent from transport/UI.
- Web and CLI channels call shared service orchestration only.
- Add new source adapters under `core-logic/readers`.
- Add new output adapters under `core-logic/generators`.

## Expected Output Standards
### BDD
- Feature-level tags
- Background section when common setup exists
- Scenario Outline format
- Example matrix for positive/negative flows
- Clear scenario naming with business context

### Jira CSV
- Import-ready structure
- Explicit preconditions, steps, and expected result
- Labels include traceability metadata

## Operational Checklist
1. Install dependencies from `requirements.txt`
2. Configure `app_config.properties` and environment variables
3. Run startup script (CLI/UI)
4. Validate output in `output`
5. Review logs in `output/platform.log`

## Extension Guidance
- Add role-based authentication in web UI if deploying beyond local.
- Add queue/worker pattern for high-volume generation.
- Integrate AI model-assisted semantic decomposition if needed.
- Add unit and integration tests under future `tests` folder.
