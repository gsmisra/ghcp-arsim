---
"applyTo": "generate-feature-file-from-jira-story"
"description": "Output-formatting, evidentiary, and enterprise banking compliance rules for Generate Feature File From Jira Story responses -- including how attachment/table data must be handled."
"owner": "QE Guild"
"version": "2.0.0"
---

# Generate Feature File From Jira Instructions

## Description

Behavioral and formatting rules that apply to every response given while the Generate Feature File From Jira Story workflow is active. Auto-selected the moment the workflow becomes active; fully editable here like any other Instruction. Where this file and the workflow's own system prompt overlap, the system prompt's output contract (the exact `Feature:`/`Scenario:`/`@tag` shape) is authoritative -- this file adds behavioral/compliance detail on top of it, it does not override it.

## Scope & Context

Applies only to the Generate Feature File From Jira Story workflow, on top of the workspace-wide Banking QE Baseline instruction (if also selected). Both apply simultaneously when both are checked in Settings; this file's rules are the more specific ones for this workflow.

## Coding Standards & Conventions

Output is Gherkin, not code -- standard `.feature` file conventions: `Feature:`, optional `Background:`, `Scenario:`/`Scenario Outline:` with `Examples:`, `Given/When/Then/And/But` steps, `@tag` lines directly above the Scenario/Scenario Outline they apply to. Indentation: 2 spaces per nesting level (Feature -> Scenario -> step), consistent throughout -- do not mix tabs and spaces in the generated file. `Examples:` tables use `|`-delimited columns with a header row, right-padded for readability where practical (not required, but preferred when it doesn't meaningfully lengthen lines).

## Do's

- Always respond with the complete `.feature` file content only, no surrounding prose, no markdown code fences, when the request is to generate the feature file.
- Always tag every Scenario/Scenario Outline with the Jira ticket key, and only that tag (see the workflow system prompt's contract).
- Always cover every provided Acceptance Criteria segment -- if a segment genuinely produces no testable scenario (e.g. it's a non-functional/manual-process note), say so explicitly in your response rather than silently omitting it.
- When the user asks a follow-up question about an already-generated feature file (e.g. "add a scenario for X", "use only the Sev1 rows from the attached data"), respond with the full updated file, not just the delta, so the user always has something complete to save.
- When attachment or embedded-table data was used as the literal source of an `Examples:` table, state which attachment/section it came from in your prose (when prose is present) so the mapping from source data to generated scenario is traceable for an auditor.
- When Description/AC content contains an embedded table (flattened as tab-separated rows -- see the Skill file), reconstruct it as a real table in your own reasoning before using it; never treat a table row as ordinary prose.

## Don'ts

- Never invent field names, error messages, or business rules not present in the provided Jira context (Description, AC, linked tickets, or attachments).
- Never produce a "Scenario:" that's really testing implementation/UI mechanics (a specific button id, a specific API endpoint path) instead of the business behavior the AC describes, unless the AC itself is written at that level of technical detail.
- Never merge two genuinely distinct Acceptance Criteria into one scenario just to shorten the file.
- Never reformat, round, re-cast currency, or change the case/locale of a concrete value taken from attachment data -- reproduce it exactly as it appeared in the source.
- Never merge rows from two different attachment sheets/files into a single logical table unless the source text explicitly indicates they represent one combined data set.
- Never present a value from a visibly truncated attachment/table as if it were the complete data set -- flag the truncation explicitly instead.

## Security & Compliance Requirements

This workflow serves a global banking platform; treat every generated artifact as something that could be reviewed by an auditor or regulator.

- **PII / sensitive data**: treat any real account numbers, customer names, SSNs/national ID numbers, card numbers, or transaction amounts appearing in the Jira ticket's Description/AC/attachments as sensitive. If example data is needed in an `Examples:` table and the ticket doesn't already provide safe synthetic values, use clearly synthetic placeholders (e.g. `ACC-TEST-0001`, `John Q. Testuser`, `4111-XXXX-XXXX-1111`) rather than reusing anything that looks like real production data -- even if it appeared in the source ticket, since a `.feature` file may be committed to a shared repository.
- **Regulatory/compliance naming discipline**: never assert or name a specific regulation (SOX, Basel III/IV, PCI-DSS, GDPR, AML/KYC directives, Dodd-Frank, MiFID II, etc.) in generated output unless that name is literally present in the source Jira content -- inventing a compliance citation is worse than omitting one.
- **Segregation of duties / dual control**: when the source material describes a maker-checker or dual-authorization workflow, scenarios must reflect that the same actor cannot both initiate and approve the same action, without asserting this is a specific named regulatory requirement unless the source says so.
- **Audit trail assertions**: when the AC implies an action must be logged/recorded/reportable, phrase the `Then` step around observable, source-grounded facts (e.g. "Then an audit log entry is created recording the user, action, and timestamp") rather than a specific log format/schema not described in the source.
- **Cross-border / data residency**: if the story implies data crossing jurisdictions (e.g. a multi-region banking platform), do not invent specific data-residency rules -- only reflect what the AC/attachment explicitly states.
- **Currency & precision**: preserve the exact currency codes, decimal precision, and rounding behavior given in the source data; do not "simplify" a `123.456` to `123.46` or assume a currency not stated.
- **Time zones & cutover times**: preserve exact times/time zones as given (e.g. "17:00 EST cutover") rather than converting or normalizing them, since cutover-time precision is often the entire point of the test.

## Testing Expectations

Prefer `Scenario Outline:` + `Examples:` for anything data-driven (multiple input/validation combinations, multiple currencies, multiple account types) over hand-written near-duplicate Scenarios -- this keeps the feature file maintainable and keeps scenario count meaningful rather than inflated. When attachment data supplies the concrete values for an Examples table, use those values verbatim (see Do's/Don'ts above) rather than a paraphrased subset.

## References / Links

See generate-feature-file-from-jira-skill.md for the scenario-design procedure, the detailed DOCX/XLSX/CSV attachment-reading rules, and the banking-domain scenario taxonomy. See generate-feature-file-from-jira-prompt.md for the response persona.
