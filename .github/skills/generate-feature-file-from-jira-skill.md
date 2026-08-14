---
"name": "Generate Feature File From Jira Story"
"description": "How to turn a Jira story's Acceptance Criteria into a clean, well-scoped Gherkin/BDD .feature file."
"owner": "QE Guild"
"version": "1.0.0"
---

# Generate Feature File From Jira Story

## Description

How to read a fetched Jira story (Summary, Description, one or more Acceptance Criteria segments, optional linked-ticket context, optional parsed attachment data) and turn it into a single, well-scoped Gherkin `.feature` file. Auto-selected the moment the workflow becomes active; fully editable here like any other Skill.

## When To Use

Whenever the loaded context contains a fetched Jira story's Description/Acceptance Criteria and the user has asked to generate the feature file (or asked a follow-up question about the scenarios already generated).

## Applicable Scope

Generate Feature File From Jira Story workflow only -- context sections labeled "Jira: <TICKET> Description", "Jira: <TICKET> AC<n>", "Jira: Linked ticket <TICKET>", and "Jira: Attachment: <filename>".

## Procedure

1. Read the Description first for overall intent, then every Acceptance Criteria segment in order -- each AC segment should map to at least one Scenario or Scenario Outline; never silently drop one.
2. For each AC segment, identify: the happy-path behavior, any boundary/limit condition it implies (counts, timeouts, thresholds), and any validation/error behavior it implies. Only write scenarios for what's actually implied -- don't manufacture edge cases the AC never mentions.
3. When the same Given/When/Then shape repeats with only data changing (different inputs, different expected messages), use one "Scenario Outline:" with an "Examples:" table instead of multiple near-duplicate Scenarios.
4. Add a "Background:" only when two or more scenarios genuinely share the same setup steps -- if only one scenario needs it, put the steps directly in that scenario instead.
5. Tag every Scenario/Scenario Outline with exactly one `@<TICKET-KEY>` tag so generated coverage traces back to the story.
6. If linked-ticket context is present, treat it as supporting detail (e.g. a shared component's existing behavior) -- do not generate separate scenarios for the linked ticket itself unless the current story's AC directly references it.
7. If attachment data (a table of test data, a spec spreadsheet) is present, prefer it as the source for an Examples table's concrete values over inventing plausible-looking data.

## Inputs

Jira Summary, Description, one or more Acceptance Criteria segments, optionally linked-ticket text and parsed attachment content, plus the user's request (typically the automatic "generate the feature file" trigger, or a follow-up refinement question).

## Outputs

Per the workflow's output contract: the complete Gherkin `.feature` file content only, ready to save as-is.

## Edge Cases & Constraints

If an AC segment is a single vague sentence with no concrete detail, write the simplest reasonable scenario for it and do not pad it with invented specifics. If the Acceptance Criteria field had no detectable AC1/AC2-style markers, it was passed through as one whole segment -- read it as a single block of criteria rather than assuming it's already scenario-ready.

## Anti-Patterns / Do NOT

Do not write a wall of near-identical Scenarios where a Scenario Outline would say it once. Do not invent UI element names, field labels, or error message text not present in the AC/Description. Do not skip an AC segment because it seems minor -- if it's testable, it gets a scenario.

## Related Skills / Instructions / Links

See generate-feature-file-from-jira-instruction.md for output-formatting rules and the workflow's system prompt for the full output contract.

## Review Notes
