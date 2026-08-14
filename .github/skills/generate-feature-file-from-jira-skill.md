---
"name": "Generate Feature File From Jira Story"
"description": "How to turn a Jira story's Acceptance Criteria -- including embedded tables and docx/xlsx/csv attachment data -- into a clean, well-scoped, enterprise-grade Gherkin/BDD .feature file for a global banking platform."
"owner": "QE Guild"
"version": "2.0.0"
---

# Generate Feature File From Jira Story

## Description

How to read a fetched Jira story (Summary, Description, one or more Acceptance Criteria segments, optional linked-ticket context, optional parsed attachment data from Word/Excel/CSV files) and turn it into a single, well-scoped, audit-ready Gherkin `.feature` file suitable for a tier-1 global bank's QE pipeline. Auto-selected the moment the workflow becomes active; fully editable here like any other Skill.

This skill assumes the reader (the model) has **no visibility into the original binary files** -- every attachment has already been converted to plain text by the extension before it reaches you. The "Reading Attachment & Embedded Table Data" section below documents *exactly* how that conversion works, format by format, so you can reconstruct the original tabular structure correctly instead of guessing at it.

## When To Use

Whenever the loaded context contains a fetched Jira story's Description/Acceptance Criteria and the user has asked to generate the feature file (or asked a follow-up question about the scenarios already generated, e.g. "add a scenario for X", "regenerate using only the Sev1 test data").

## Applicable Scope

Generate Feature File From Jira Story workflow only -- context sections labeled:
- `Jira: <TICKET> Description`
- `Jira: <TICKET> AC<n>` (or `Jira: <TICKET> Acceptance Criteria` when the field had no AC1/AC2-style sub-markers)
- `Jira: Linked ticket <TICKET>`
- `Jira: Attachment: <filename>`

## Procedure

1. Read the Description first for overall intent, then every Acceptance Criteria segment in order -- each AC segment should map to at least one Scenario or Scenario Outline; never silently drop one.
2. For each AC segment, identify: the happy-path behavior, any boundary/limit condition it implies (counts, timeouts, thresholds, cutover times), and any validation/error behavior it implies. Only write scenarios for what's actually implied -- don't manufacture edge cases the AC never mentions.
3. When the same Given/When/Then shape repeats with only data changing (different inputs, different expected messages, different currencies, different account types), use one "Scenario Outline:" with an "Examples:" table instead of multiple near-duplicate Scenarios.
4. Add a "Background:" only when two or more scenarios genuinely share the same setup steps -- if only one scenario needs it, put the steps directly in that scenario instead.
5. Tag every Scenario/Scenario Outline with exactly one `@<TICKET-KEY>` tag so generated coverage traces back to the story (per the workflow's system-prompt contract -- do not add additional tags beyond this single ticket-key tag, even if it would be tempting to add `@smoke`/`@regression`-style tags; that contract takes precedence over any suggestion elsewhere).
6. If linked-ticket context is present, treat it as supporting detail (e.g. a shared component's existing behavior, an upstream dependency's contract) -- do not generate separate scenarios for the linked ticket itself unless the current story's AC directly references it.
7. If attachment data (a table of test data, a validation-rules spreadsheet, a data dictionary) is present, prefer it as the source for an Examples table's concrete values over inventing plausible-looking data -- see the dedicated section below for how to read it correctly.
8. Before finalizing, do a coverage pass: list every AC segment and every attachment data row/rule against the scenarios you've written -- anything unaccounted for either gets a scenario or an explicit, stated reason it was intentionally out of scope (e.g. "AC3 describes a manual ops procedure, not an automatable behavior -- no scenario generated").

## Reading Attachment & Embedded Table Data

Attachment content and any tables embedded directly in the Description/Acceptance Criteria text are **not raw files** -- they have already been parsed and flattened to plain text by the extension. Each format is flattened differently. Getting this right is the difference between correctly reconstructing a validation matrix and silently corrupting it.

### DOCX attachments (and embedded tables inside the Description/AC fields)

Word content -- both a `.docx` attachment and any table Jira rendered inline inside the Description/Acceptance Criteria wiki-markup -- is flattened the same way:
- Ordinary paragraphs and headings become plain text lines, one per line, in document order. No bold/italic/heading-level markup survives; a heading looks exactly like a paragraph.
- **Tables use TAB characters (`\t`) to separate cells within a row, and a newline to separate rows.** The first row is very often (though not guaranteed) a header row naming the columns -- infer this from content (e.g. short, label-like text in row 1 vs. data-like values in later rows), not from any markup, since none survives.
- There is no cell-merge, borders, or column-width information -- if a row appears to have fewer tab-separated fields than the header row, treat the missing trailing fields as blank/not-applicable rather than shifting later columns to fill the gap.
- A `.docx` attachment's approximate page range (if the user narrowed it via "Control the data sent in the context") only affects *how much* of the document you see, not its structure -- everything you do see follows the rules above.

**How to parse it mentally:** split the section's text into lines; a line containing one or more `\t` characters is a table row -- split that line on `\t` to get its cells. A run of consecutive tab-containing lines is one table; a table ends at the first line with no tab character.

### XLSX (Excel) attachments

- Cell values are the **displayed** values (e.g. a currency cell shows `1,234.56` or `$1,234.56` as formatted in the spreadsheet, not a raw floating-point number; a date shows as it was displayed, not a serial number) -- treat every value as the literal string you see, do not attempt to reformat, round, or "normalize" it, since the business analyst may have chosen that exact formatting deliberately (e.g. a specific currency/locale format under test).
- Each sheet's data is standard comma-separated values (RFC-4188-style: a value containing a comma, quote, or newline is wrapped in double quotes) with the **first row as column headers**, taken directly from the sheet's own header row.
- A workbook with multiple included sheets shows each one delimited by its own marker line: `--- Sheet: <sheet name> ---`, followed by that sheet's header row and data rows, before the next sheet's marker (if any) begins. **Never merge rows from two different sheets into one logical table** -- unless the sheet *names* or the surrounding Description/AC text explicitly say they're two halves of one data set (e.g. sheets named "Positive Cases" and "Negative Cases" for the same feature), treat each sheet as an independent data source.
- If only one sheet is shown with no `--- Sheet: ... ---` marker at all, the workbook had only one relevant sheet selected (the extension defaults to the first sheet when the user hasn't explicitly picked others) -- don't assume other sheets don't exist in the original file, only that they weren't included in this context.

### CSV attachments

- Standard comma-separated values, header row first, exactly as uploaded -- the least transformed of the three formats. Quoted fields (containing commas/quotes/newlines) follow normal CSV quoting; unescape them mentally (a doubled `""` inside a quoted field is one literal `"`).
- Column headers are the actual source-file headers -- use them verbatim when naming what a value represents (e.g. a column literally named `Expected_HTTP_Status` should map directly to a "Then" step assertion, not be paraphrased into something vaguer).

### Using attachment/table data to build scenarios

- When a table's shape looks like a validation or test-data matrix (columns resembling *Input / Rule / Expected Result*, or *Field Name / Format / Error Message*, or similar), this is very likely intended as the literal source for a `Scenario Outline:`'s `Examples:` table -- reproduce the values **verbatim** (same casing, same currency symbols, same date format) rather than paraphrasing or "cleaning them up". This may be authoritative test data the business analyst or QE lead already agreed on.
- **Truncation awareness**: content may have been cut off to fit the model's context window (a per-attachment character budget applies, shown in the Context Limit meter). If a table appears to end mid-row, without a clearly final row, or a sheet's marker appears with no rows under it, treat that as **truncated data**, not as "the table has ended" -- say so explicitly in your response (e.g. "Note: the attached data appeared to be truncated; scenarios below are based only on the visible rows") rather than silently treating a partial extract as complete.
- If two attachments or an attachment and the AC text conflict on a concrete value (e.g. AC says "3 retry attempts", the attached spreadsheet's data implies 5), prefer the Acceptance Criteria as the source of truth and note the discrepancy rather than picking one silently.

## Banking-Domain Scenario Taxonomy (calibration guidance)

This workflow generates coverage for a global banking platform. When an AC/attachment touches one of these domains, calibrate scenario emphasis accordingly (these are guidance for *what to prioritize*, not a checklist to force into every story):

- **Money movement** (payments, transfers, wires, SWIFT/ACH/RTGS/SEPA rails): always include at least one boundary scenario for amount limits/thresholds if the AC implies any, and a scenario for insufficient-funds/failed-transfer handling if implied.
- **Authentication & authorization**: distinguish "wrong credentials" (authentication failure) from "correct credentials, insufficient entitlement" (authorization failure) as separate scenarios when the AC implies both are possible.
- **Dual control / four-eyes / segregation of duties**: if the AC or attachment describes an approval workflow (maker-checker), include a scenario asserting the *same* user cannot both create and approve the same action, when that constraint is stated or clearly implied.
- **Reconciliation & batch processing**: scenarios involving cutover times, batch windows, or end-of-day processing should state the relevant time boundary explicitly as given in the AC (do not invent a specific cutover time not present in the source).
- **Regulatory reporting / audit trail**: when the AC implies a record must be retained, logged, or reported, include a scenario asserting the audit/log entry exists with the right key fields (do not invent specific regulation names like "SOX" or "Basel III" unless the AC/attachment text itself names them).
- **Data validation** (account numbers, routing/SWIFT/IBAN codes, currency codes): boundary and format-validation scenarios are usually warranted -- use `Scenario Outline:` with an `Examples:` table for the different invalid-format cases, sourced from attachment data when available.

## Inputs

Jira Summary, Description, one or more Acceptance Criteria segments, optionally linked-ticket text and parsed attachment content (docx/xlsx/csv, flattened per the rules above), plus the user's request (typically the automatic "generate the feature file" trigger, or a follow-up refinement question).

## Outputs

Per the workflow's output contract: the complete Gherkin `.feature` file content only, ready to save as-is.

## Edge Cases & Constraints

If an AC segment is a single vague sentence with no concrete detail, write the simplest reasonable scenario for it and do not pad it with invented specifics. If the Acceptance Criteria field had no detectable AC1/AC2-style markers, it was passed through as one whole segment -- read it as a single block of criteria rather than assuming it's already scenario-ready. If an attachment's file kind couldn't be determined or its content is empty, it will simply be absent from the context -- do not reference a file you don't actually see content for.

## Anti-Patterns / Do NOT

Do not write a wall of near-identical Scenarios where a Scenario Outline would say it once. Do not invent UI element names, field labels, or error message text not present in the AC/Description/attachments. Do not skip an AC segment because it seems minor -- if it's testable, it gets a scenario. Do not merge two different attachments' or two different sheets' data into one table unless the source text explicitly says they're related. Do not reformat currency, date, or numeric values from attachment data -- reproduce them exactly as given. Do not name a specific banking regulation (SOX, Basel III, PCI-DSS, GDPR, etc.) unless that name actually appears in the source material.

## Related Skills / Instructions / Links

See generate-feature-file-from-jira-instruction.md for output-formatting rules and the workflow's system prompt for the full output contract.

## Review Notes
