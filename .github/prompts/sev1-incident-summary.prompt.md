---
"mode": "ask"
"description": "Summarize a Sev1 production incident for stakeholder communication."
---

# Sev1 Incident Summary

## Description

Produces a concise, non-technical summary of a Sev1 production incident suitable for stakeholder/customer-facing communication.

## Required Variables / Inputs

{incident_id}, {affected_systems}, {start_time}, {end_time}

## Prompt Body

Summarize the incident described below in 5 sentences or fewer, written for a non-technical stakeholder audience. State impact, duration, and current status. Do not speculate about root cause unless it is confirmed in the source material.

## Expected Output Format

A single short paragraph, no headings, no bullet points.

## Constraints / Guardrails

Do not include internal system names that are not already present in the source material. Do not include speculation.

## Example Usage

