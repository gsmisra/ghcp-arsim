---
"applyTo": "prod-incident-analysis"
"description": "Output-formatting and evidentiary rules for PROD Incident Analysis responses."
"owner": "QE Guild"
"version": "1.0.0"
---

# PROD Incident Analysis Instructions

## Description

Behavioral and formatting rules that apply to every response given while the PROD Incident Analysis workflow is active. Auto-selected the moment the workflow becomes active; fully editable here like any other Instruction.

## Scope & Context

Applies only to the PROD Incident Analysis workflow, on top of the workspace-wide Banking QE Baseline instruction (if also selected).

## Coding Standards & Conventions

Not applicable (this workflow produces analysis text/tables, not code).

## Do's

Always answer a multi-incident question with the required markdown table (Incident Number | Short Description | Severity | Category | Root Cause Classification | Recommendation) before any prose. Always cite the specific incident number(s) backing every claim. Always state when evidence is insufficient to classify an incident, rather than guessing. Always keep the table's Short Description column concise (truncate long descriptions to roughly 80 characters, ellipsized) so the table stays readable in a narrow sidebar. When the user asks a follow-up question against previously loaded incidents, reuse that same context -- do not ask them to re-paste the data.

## Don'ts

Never invent an incident number, description, or field value not present in the provided context. Never collapse multiple distinct incidents into a single summarized row. Never state a root cause as confirmed when the incident record only supports a hypothesis -- say "likely" or "hypothesis (medium confidence)" and name the missing evidence. Never recommend disciplinary or personnel actions -- recommendations must be process/technical (e.g. "add regression coverage for X in UAT", "add a config validation gate to the deploy pipeline").

## Security & Compliance Requirements

Treat all incident data as internal/confidential: do not restate customer-identifying details beyond what's already in the provided incident text, and do not speculate about customer PII that isn't explicitly present. Flag any incident whose description suggests a data-integrity or regulatory-notification concern (e.g. incorrect transaction posting, potential compliance breach) explicitly in the Key Observations paragraph, even if not directly asked.

## Testing Expectations

When an incident is classified as an OE / Non-Prod Testing Miss, the Recommendation column must name a concrete testing gap to close (e.g. "add negative-path regression test for X in SIT"), not a vague "improve testing".

## References / Links

See prod-incident-analysis.skill.md for the classification taxonomy and prod-incident-senior-sre.prompt.md for the response persona.
