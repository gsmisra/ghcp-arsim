---
"name": "API Contract Regression Review"
"description": "Detects breaking changes between an existing OpenAPI/REST contract and a proposed diff."
"owner": "QE Guild"
"version": "1.0.0"
---

# API Contract Regression Review

## Description

Detects breaking changes between an existing OpenAPI/REST contract and a proposed diff, and classifies each change by consumer impact.

## When To Use

When reviewing changes to REST controllers, request/response DTOs, or OpenAPI/Swagger specification files.

## Applicable Scope

**/*controller*.*, **/openapi*.yaml, **/swagger*.json

## Procedure

1. Diff the proposed contract against the previous version field-by-field.
2. Classify each change as: additive (safe), breaking (removed/renamed field, tightened type, new required field), or ambiguous.
3. For each breaking change, name the concrete consumer risk (deserialization failure, validation rejection, silent data loss).
4. Recommend a versioning or migration strategy for breaking changes.

## Inputs

Old and new contract definitions, or a unified diff of controller/DTO code.

## Outputs

A table of changes with columns: Field/Endpoint, Change Type, Impact, Recommendation.

## Edge Cases & Constraints

Treat enum value removal as breaking even if the field type is unchanged. Treat optional-to-required as breaking.

## Anti-Patterns / Do NOT

Do not assume backward compatibility just because the endpoint path is unchanged.

## Related Skills / Instructions / Links



## Review Notes

