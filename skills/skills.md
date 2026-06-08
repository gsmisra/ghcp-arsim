# GHCP QE Skills Catalog

## Skill: Requirement Ingestion and Normalization
Purpose:
- Standardize requirement extraction from document, Confluence, Jira/JTMF sources.
- Preserve requirement traceability with metadata.

Inputs:
- Document (`docx`, `xlsx`, `pdf`, `csv`)
- Confluence page URL or page ID
- Jira/JTMF story ID(s)

Actions:
- Parse source content using dedicated adapters in `core-logic/readers`.
- Capture source identifiers and ingestion timestamp metadata.
- Flatten nested markup structures for test generation readiness.

Outputs:
- Normalized requirement payload with title, source, body text, metadata.

## Skill: Confluence Recursive Harvesting
Purpose:
- Read parent page, child pages, and attachments recursively to max depth 5.

Actions:
- Resolve page ID from URL.
- Retrieve page body from Confluence REST API.
- Traverse child pages breadth-first.
- Download and parse supported attachments (`pdf`, `docx`, `xlsx`, `csv`).

Controls:
- `MAX_CONFLUENCE_DEPTH` config.
- Optional TLS verification toggle.

## Skill: Jira Story Aggregation
Purpose:
- Pull one or many Jira/JTMF stories and convert to testable requirement text.

Actions:
- Fetch issue summary, description, acceptance criteria, comments.
- Flatten Atlassian Document Format (ADF) into plain text.
- Keep per-story traceability for generated outputs.

## Skill: Detailed Test Case Synthesis
Purpose:
- Produce enterprise-grade detailed test cases for banking QE.

Actions:
- Build scenario objectives from requirement narrative.
- Auto-tag scenarios for domain and execution priority.
- Add preconditions, procedural steps, validations, and observability checks.
- Include positive and negative data combinations.

## Skill: BDD Feature Generation
Purpose:
- Generate robust `*.feature` files for BDD execution and review.

Rules:
- Add top-level feature tags and scenario tags.
- Add `Background` section for shared preconditions.
- Use `Scenario Outline` with `Examples`.
- Include data tables for business combinations.

## Skill: Jira CSV Generation
Purpose:
- Generate Jira-importable test cases in CSV format.

Rules:
- Emit structured fields: summary, description, preconditions, steps, expected result, labels.
- Preserve business context and scenario intent.

## Skill: Enterprise Controls and Operability
Purpose:
- Ensure maintainability and bank-grade posture.

Practices:
- All integration logic isolated under `core-logic`.
- Config-driven endpoints and credentials.
- Output artifacts centralized under `output`.
- Structured platform logging into `output/platform.log`.
- Separation of source adapters, generator logic, orchestration, and UI.
