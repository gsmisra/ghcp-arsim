---
"name": "PROD Incident Analysis (ServiceNow)"
"description": "How to read ServiceNow incident records and classify production incidents by root-cause category for banking systems."
"owner": "QE Guild"
"version": "1.0.0"
---

# PROD Incident Analysis (ServiceNow)

## Description

How to read a fetched set of ServiceNow `incident` table records and turn them into a categorized, evidence-grounded analysis. Auto-selected the moment the PROD Incident Analysis workflow becomes active; fully editable here like any other Skill.

## When To Use

Whenever the loaded context contains ServiceNow incident data (fetched via MAL code + date range) and the user asks a question that involves comparing, grouping, filtering, or summarizing across those incidents.

## Applicable Scope

PROD Incident Analysis workflow only -- incident records with fields: Incident Number, Short Description, Severity, Priority, State, Created, Application Code, Assignment Group, Category, Description.

## Procedure

1. Read every incident's Short Description, Description, Category, and Assignment Group before classifying -- Severity/Priority alone never determine root-cause category.
2. Classify each incident into exactly one root-cause category:
   - **OE / Non-Prod Testing Miss** -- the defect existed and was reachable in a lower environment (SIT/UAT/Perf) but wasn't caught before release; language cues include "missed in testing", "not covered by test cases", "regression not caught in UAT".
   - **Technical / Configuration Issue** -- infrastructure, deployment, environment configuration, connectivity, capacity, or integration/interface failure that is not a code logic defect; cues include "config drift", "certificate expired", "connection pool exhausted", "firewall rule", "deployment failed".
   - **Functional Defect** -- an actual application business-logic bug, present in the code regardless of environment; cues include "incorrect calculation", "wrong validation", "logic error".
   - **Data Issue** -- bad, missing, or stale data (not a code or config defect) causing the symptom.
   - **Third-Party / Vendor** -- an upstream vendor/dependency outage or defect outside the bank's own systems.
   - **Unknown** -- the record doesn't contain enough evidence to classify confidently. Prefer Unknown over guessing.
3. Map ServiceNow Severity/Priority text to the four display levels this workflow uses everywhere (chat tables, ticket-selection UI, Context Limit context): Critical/Sev1 -> Red, High/Sev2 -> Amber, Medium/Sev3 -> Yellow, Low/Sev4/Minor -> Green.
4. When asked for patterns, group by Category and by Assignment Group, and call out any single application/component (Application Code) responsible for a disproportionate share of incidents.
5. Every classification must cite the specific incident number(s) it's based on -- never issue an unattributed generalization.

## Inputs

The fetched incident table (Incident Number, Short Description, Severity, Priority, State, Created, Application Code, Assignment Group, Category, Description) plus the user's specific question.

## Outputs

Per the workflow's output contract: a markdown table (Incident Number | Short Description | Severity | Category | Root Cause Classification | Recommendation) for multi-incident questions, or grounded prose for single-incident/narrative questions.

## Edge Cases & Constraints

If Description/work notes are empty or truncated, classify using only Short Description and say explicitly that the classification is low-confidence due to limited detail -- do not fill the gap with assumptions. If two categories seem equally plausible, choose Unknown rather than picking one arbitrarily.

## Anti-Patterns / Do NOT

Do not classify based on Severity/Priority alone (a Sev1 can be any category). Do not treat "root cause unknown/still investigating" ServiceNow states as license to invent a cause. Do not merge distinct incidents into one row even if their descriptions look similar -- always report per incident number.

## Related Skills / Instructions / Links

See prod-incident-analysis.instructions.md for output-formatting rules and the PROD Incident Analysis workflow's system prompt for the full output contract.

## Review Notes
