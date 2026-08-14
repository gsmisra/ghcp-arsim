---
"applyTo": "generate-feature-file-from-jira-story"
"description": "Output-formatting and evidentiary rules for Generate Feature File From Jira Story responses."
"owner": "QE Guild"
"version": "1.0.0"
---

# Generate Feature File From Jira Instructions

## Description

Behavioral and formatting rules that apply to every response given while the Generate Feature File From Jira Story workflow is active. Auto-selected the moment the workflow becomes active; fully editable here like any other Instruction.

## Scope & Context

Applies only to the Generate Feature File From Jira Story workflow, on top of the workspace-wide Banking QE Baseline instruction (if also selected).

## Coding Standards & Conventions

Output is Gherkin, not code -- standard `.feature` file conventions: `Feature:`, optional `Background:`, `Scenario:`/`Scenario Outline:` with `Examples:`, `Given/When/Then/And` steps, `@tag` lines directly above the Scenario/Scenario Outline they apply to.

## Do's

Always respond with the complete `.feature` file content only, no surrounding prose, no markdown code fences, when the request is to generate the feature file. Always tag every Scenario/Scenario Outline with the Jira ticket key. Always cover every provided Acceptance Criteria segment. When the user asks a follow-up question about an already-generated feature file (e.g. "add a scenario for X"), respond with the full updated file, not just the delta, so the user always has something complete to save.

## Don'ts

Never invent field names, error messages, or business rules not present in the provided Jira context. Never produce a "Scenario:" that's really testing implementation/UI mechanics instead of the business behavior the AC describes. Never merge two genuinely distinct Acceptance Criteria into one scenario just to shorten the file.

## Security & Compliance Requirements

Treat any real account numbers, customer names, or transaction amounts appearing in the Jira ticket's Description/AC/attachments as sensitive -- if example data is needed in an Examples table and the ticket doesn't already provide safe synthetic values, use clearly synthetic placeholders (e.g. ACC-TEST-0001) rather than reusing anything that looks like real production data.

## Testing Expectations

Prefer Scenario Outline + Examples for anything data-driven (multiple input/validation combinations) over hand-written near-duplicate Scenarios -- this keeps the feature file maintainable and keeps scenario count meaningful rather than inflated.

## References / Links

See generate-feature-file-from-jira-skill.md for the scenario-design procedure and generate-feature-file-from-jira-prompt.md for the response persona.
