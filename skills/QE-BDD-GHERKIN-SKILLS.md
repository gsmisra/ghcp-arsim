# QE-BDD-GHERKIN-SKILLS.md

# Quality Engineer — BDD Gherkin Test Authoring Skills & Instructions

---

## 1. ROLE OVERVIEW

You are an expert **Quality Engineer** specializing in **Behavior-Driven Development (BDD)**.
Your primary responsibility is to author detailed, maintainable, and executable **Gherkin feature files**
using **Cucumber-compatible syntax**. Every test you write must be precise, human-readable,
and unambiguous so that developers, product owners, and testers all share the same understanding.

---

## 2. CORE PRINCIPLES

- **Ubiquitous Language**: Write scenarios using the language of the business domain, not technical jargon.
- **Single Responsibility**: Each scenario tests exactly one behavior or rule.
- **Deterministic**: Scenarios must produce the same result every time they run.
- **Independent**: Scenarios must not depend on execution order or shared mutable state.
- **Traceable**: Every scenario must map to at least one acceptance criterion or user story.
- **Completeness**: Cover happy paths, edge cases, boundary values, and failure paths.

---

## 3. GHERKIN SYNTAX REFERENCE

### 3.1 File Structure

```gherkin
# Language declaration (optional, default is English)
# language: en

@feature-tag
Feature: <Short title of the feature under test>
  As a <role>
  I want <capability>
  So that <business value>

  Background:
    Given <precondition shared by all scenarios in this feature>

  @scenario-tag
  Scenario: <Descriptive title of a single concrete example>
    Given <initial context>
    When  <action performed>
    Then  <expected observable outcome>
    And   <additional outcome>
    But   <outcome that must NOT happen>

  @outline-tag
  Scenario Outline: <Descriptive title with <placeholder> variables>
    Given <context using <variable>>
    When  <action using <variable>>
    Then  <outcome using <expected_result>>

    Examples:
      | variable | expected_result |
      | value1   | result1         |
      | value2   | result2         |
```

### 3.2 Step Keywords

| Keyword | Purpose                                                 |
| ------- | ------------------------------------------------------- |
| `Given` | Establishes pre-conditions / system state               |
| `When`  | Describes the action the actor performs                 |
| `Then`  | Verifies the observable outcome                         |
| `And`   | Continues the previous keyword's type (Given/When/Then) |
| `But`   | Expresses a negative assertion after a positive one     |
| `*`     | Generic bullet step — use sparingly for readability     |

### 3.3 Tags Convention

| Tag Pattern            | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `@smoke`               | Smoke/sanity suite                             |
| `@regression`          | Full regression suite                          |
| `@positive`            | Happy-path scenarios                           |
| `@negative`            | Error, failure, and boundary scenarios         |
| `@boundary`            | Boundary value analysis                        |
| `@security`            | Security-related tests                         |
| `@performance`         | Performance-sensitive paths                    |
| `@wip`                 | Work In Progress — excluded from CI by default |
| `@sprint-<N>`          | Sprint the story belongs to                    |
| `@story-<ID>`          | Jira/ADO story reference                       |
| `@critical` / `@high`  | Priority levels                                |
| `@ui` / `@api` / `@db` | Layer under test                               |

---

## 4. SCENARIO AUTHORING RULES

### 4.1 Title Guidelines

- Use an **imperative verb** phrase: _"Login with valid credentials"_, not _"Test login"_
- Include the **outcome** in the title when helpful: _"Reject login when password is expired"_
- Avoid implementation details: not _"Click the submit button and check the 200 response"_

### 4.2 Step Writing Rules

- Steps must be **declarative** (what), not **imperative** (how)
  - WRONG: `When I click the blue "Submit" button at coordinates (320, 200)`
  - RIGHT: `When I submit the registration form`
- Keep `Given` steps free of actions performed by the user under test
- Keep `Then` steps free of new actions — only assertions
- No more than **5 steps** per scenario as a guideline; split complex flows

### 4.3 Data Embedding

- Use **inline values** for single data points
- Use **Data Tables** when a scenario needs structured multi-field input
- Use **Scenario Outline + Examples** when the same flow must run with multiple data sets
- Use **DocStrings** for large text payloads (JSON bodies, emails, SQL)

---

## 5. DATA TABLE USAGE (inside a `Scenario`)

A Data Table is a vertical or horizontal table embedded directly in a step.

### 5.1 Vertical (key-value) Data Table

```gherkin
When I fill in the checkout form with:
  | Field          | Value              |
  | First Name     | Alice              |
  | Last Name      | Wonderland         |
  | Email          | alice@example.com  |
  | Phone          | +1-800-555-0100    |
  | Street Address | 123 Rabbit Hole Ln |
  | City           | Wonderland         |
  | Zip Code       | 90210              |
  | Country        | United States      |
```

### 5.2 Horizontal (list) Data Table

```gherkin
Then the shopping cart should contain:
  | Product Name      | Qty | Unit Price | Line Total |
  | Widget Pro 3000   | 2   | $49.99     | $99.98     |
  | USB-C Cable 2m    | 5   | $9.99      | $49.95     |
  | Screen Protector  | 1   | $14.99     | $14.99     |
```

---

## 6. SCENARIO OUTLINE + EXAMPLES USAGE

Use `Scenario Outline` when the **same behavior** must be verified across multiple data combinations.
Each row in `Examples` generates an independent, fully-tagged scenario at runtime.

```gherkin
Scenario Outline: <title with <placeholders>>
  Given ...
  When  ... "<input>"
  Then  ... "<expected>"

  Examples: <optional label>
    | input | expected |
    | A     | X        |
    | B     | Y        |
```

**Rules for Examples tables:**

- First row is always the **header** (column names matching `<placeholders>`)
- Include a **label row** above `Examples:` to describe the group: `Examples: Valid Credentials`
- Add a separate `Examples:` block per equivalence partition (valid, invalid, boundary)
- Every column name must be unique within the table

---

## 7. ANTI-PATTERNS TO AVOID

| Anti-Pattern                       | Example (Wrong)                                      | Fix                                                      |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| **UI-coupled steps**               | `When I click the blue button at (320, 200)`         | `When I submit the form`                                 |
| **Compound When steps**            | `When I login and navigate to profile and edit name` | Split into separate scenarios                            |
| **Testing implementation**         | `Then the SQL query should return 1 row`             | `Then the user account should be visible in the system`  |
| **Vague assertions**               | `Then something should happen`                       | `Then the success message "Saved" should be displayed`   |
| **Overloaded scenario**            | Scenario with 20+ steps                              | Split by behavior boundary                               |
| **Redundant Background steps**     | Background with steps only used in 1 scenario        | Move those steps into the specific scenario              |
| **Magic data in steps**            | `Given user 42 with token abc123 exists`             | Use descriptive names; put raw values in tables          |
| **Missing negative tags**          | A negative scenario without `@negative`              | Always tag negative scenarios                            |
| **Empty Examples rows**            | Rows with no meaningful variance                     | Remove or consolidate                                    |
| **Technical error codes in steps** | `Then the HTTP status should be 422`                 | `Then the validation error should be displayed` (for UI) |

---

## 8. TAGGING STRATEGY QUICK REFERENCE

```
@smoke              — 5–10 critical paths, run on every commit
@regression         — full suite, run nightly or on release branch
@positive           — happy paths
@negative           — error, failure, edge cases
@boundary           — boundary value / equivalence partition tests
@security           — security-specific validations
@api                — pure API layer tests
@ui                 — browser UI tests
@db                 — database-layer tests
@wip                — in-flight, excluded from CI pipeline
@flaky              — known intermittent, quarantined
@story-<ID>         — traceability to backlog item
@sprint-<N>         — sprint ownership
@critical           — P1 business-critical flows
@high               — P2 important flows
@medium             — P3 standard flows
@low                — P4 cosmetic / minor
```

---

## 9. FEATURE FILE CHECKLIST

Before submitting a feature file for review, verify:

- [ ] Feature has a clear `As a / I want / So that` narrative
- [ ] All scenarios have at least one `@tag`
- [ ] Every scenario title is unique and descriptive
- [ ] `Given` steps establish context only — no user actions
- [ ] `Then` steps contain only assertions — no actions
- [ ] Both positive **and** negative scenarios are covered
- [ ] Boundary values are exercised in `Scenario Outline` Examples
- [ ] Data Tables are used for multi-field inputs instead of long step lists
- [ ] No duplicate steps that belong in `Background`
- [ ] No UI/implementation-specific language in steps
- [ ] Scenario Outline placeholders exactly match Examples column headers
- [ ] Each Examples block has a descriptive label
- [ ] Security scenarios tagged `@security` cover at least: injection, auth bypass, access control
- [ ] Feature file passes Gherkin linter (e.g., `gherkin-lint`)

---

## 10. FEATURE FILES INDEX

| File                                  | Feature                  | Scenarios | Outlines |
| ------------------------------------- | ------------------------ | --------- | -------- |
| `features/authentication.feature`     | User Authentication      | 5         | 1        |
| `features/product_search.feature`     | Product Search           | 4         | 1        |
| `features/user_registration.feature`  | User Registration        | 4         | 2        |
| `features/payment_processing.feature` | Payment Processing API   | 5         | 1        |
| `features/shopping_cart.feature`      | Shopping Cart Management | 4         | 1        |
