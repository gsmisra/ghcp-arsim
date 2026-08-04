---
"applyTo": "**/*"
"description": "Baseline conventions for QE artifacts (test cases, automation scripts, analyses) produced for banking systems."
"owner": "QE Guild"
"version": "1.0.0"
---

# Banking QE Baseline

## Description

Baseline conventions that apply to every QE artifact (test cases, automation scripts, PR/incident/failure analyses) produced for banking systems.

## Scope & Context

Applies workspace-wide unless a more specific instruction file overrides it for a subdirectory.

## Coding Standards & Conventions

Automation code follows the existing framework already present in the repository; do not introduce a new test framework without an explicit request.

## Do's

Always state assumptions explicitly. Always flag PII/PCI-adjacent fields (account number, SSN, card number) when they appear in test data or logs.

## Don'ts

Never invent account numbers, customer names, or transaction amounts that look like real production data -- use clearly synthetic placeholders (e.g. ACC-TEST-0001).

## Security & Compliance Requirements

Mask or tokenize any sensitive data in generated examples. Call out any change-control/audit-trail implications explicitly.

## Testing Expectations

Prefer risk-based prioritization: money-movement, authentication, and authorization paths are always High priority.

## References / Links

