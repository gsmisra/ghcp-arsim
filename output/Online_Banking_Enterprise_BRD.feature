@qe @enterprise @document
Feature: Online Banking Enterprise Brd
  As a QE engineer in banking delivery
  I want robust and traceable automated test scenarios
  So that business critical workflows remain reliable and compliant

  Background:
    Given A valid retail customer account exists in the system
    And Core banking APIs are available and responding
    And Enterprise IAM is configured with MFA support
    And Test environment is seeded with representative customer and account data

  @@online-banking @@regression @@smoke @@positive @@negative @@security @@boundary @@critical @@high @@ui @@api
  Scenario Outline: Gherkin Feature File: Online Banking Enterprise Application
    When Author and execute each Gherkin scenario in the feature file below
    Then All positive scenarios pass with correct business outcomes
    And All negative scenarios surface appropriate error messages or access denials
    And Scenario Outlines execute once per Examples row
    And Security scenarios return access-denied responses for injection and bypass attempts

    Examples:
      | content | feature_file |
      | # language: en

@online-banking @regression
Feature: Online Banking Core Journeys
  As a retail or small business customer
  I want to securely authenticate, manage accounts, perform transfers, pay bills, and control my card
  So that I can complete everyday banking digitally without visiting a branch

  Background:
    Given the following active customer accounts exist in the system:
      | Customer ID | Full Name       | Email                      | Account Number | Account Type | Available Balance | Status |
      | CUST-001    | Alice Mercer    | alice.mercer@example.com   | ACC-10010001   | Checking     | 5000.00           | Active |
      | CUST-002    | Bob Tanaka      | bob.tanaka@example.com     | ACC-10010002   | Savings      | 12000.00          | Active |
      | CUST-003    | Carol Nguyen    | carol.nguyen@example.com   | ACC-10010003   | Checking     | 200.00            | Active |
      | CUST-004    | David Okonkwo   | david.okonkwo@example.com  | ACC-10010004   | Checking     | 500.00            | Locked |
    And the core banking API is available
    And the enterprise IAM service is operational

  # ============================================================
  # SCENARIO 1: Successful Multi-Factor Authentication Login
  # ============================================================
  @smoke @positive @critical @ui @story-AUTH-001
  Scenario: Authenticate successfully with valid credentials and MFA
    Given the customer "alice.mercer@example.com" exists and their account is active
    And the customer has MFA enrolled via authenticator app
    When the customer submits their login credentials with:
      | Field    | Value                    |
      | Email    | alice.mercer@example.com |
      | Password | SecureP@ss1!             |
    And the customer provides a valid one-time passcode from their authenticator app
    Then the customer should be directed to their account dashboard
    And the dashboard should display a welcome message for "Alice Mercer"
    But the system should not grant access without the valid one-time passcode

  # ============================================================
  # SCENARIO 2: Account Lockout After Repeated Failed Login Attempts
  # ============================================================
  @regression @negative @security @critical @ui @story-AUTH-002
  Scenario: Lock account after exceeding maximum failed login attempts
    Given the customer "alice.mercer@example.com" exists and their account is active
    And the customer has made 4 consecutive failed login attempts
    When the customer submits an incorrect password for the 5th time
    Then the account should be temporarily locked
    And an account lockout notification should be sent to "alice.mercer@example.com"
    And the error message "Your account has been locked due to multiple failed login attempts. Please contact support." should be displayed
    But the customer should not be authenticated

  # ============================================================
  # SCENARIO 3: Domestic Fund Transfer Between Own Accounts (Happy Path)
  # ============================================================
  @smoke @positive @critical @ui @story-TRANS-001
  Scenario: Transfer funds successfully between own accounts within available balance
    Given the customer "alice.mercer@example.com" is authenticated on the dashboard
    And account "ACC-10010001" has an available balance of "5000.00" USD
    When the customer initiates a fund transfer with the following details:
      | Field                  | Value        |
      | From Account           | ACC-10010001 |
      | To Account             | ACC-10010002 |
      | Amount                 | 500.00       |
      | Currency               | USD          |
      | Transfer Date          | Today        |
      | Reference / Memo       | Rent payment |
    And the customer confirms the transfer after reviewing the fee disclosure
    Then the transfer should be processed straight-through without manual intervention
    And a unique transaction reference number should be displayed
    And a transfer confirmation notification should be sent to "alice.mercer@example.com"
    And the available balance for account "ACC-10010001" should be reduced by "500.00" USD

  # ============================================================
  # SCENARIO 4: Bill Payment — Scenario Outline with Boundary and Negative Examples
  # ============================================================
  @regression @story-BILLPAY-001
  Scenario Outline: Validate bill payment amount boundaries and eligibility
    Given the customer "alice.mercer@example.com" is authenticated on the dashboard
    And account "ACC-10010001" has an available balance of "<available_balance>" USD
    And the biller "<biller_name>" is registered and active
    When the customer submits a bill payment with the following details:
      | Field          | Value               |
      | From Account   | ACC-10010001        |
      | Biller         | <biller_name>       |
      | Amount         | <payment_amount>    |
      | Currency       | USD                 |
      | Payment Date   | Today               |
    Then the outcome should be "<expected_outcome>"
    And the message "<expected_message>" should be displayed

    Examples: Valid Payment Amounts — Positive Cases
      | available_balance | biller_name       | payment_amount | expected_outcome | expected_message                                      |
      | 5000.00           | City Electric Co  | 0.01           | Success          | Your bill payment has been submitted successfully.    |
      | 5000.00           | City Electric Co  | 2500.00        | Success          | Your bill payment has been submitted successfully.    |
      | 5000.00           | City Electric Co  | 5000.00        | Success          | Your bill payment has been submitted successfully.    |

    Examples: Insufficient Funds — Negative Cases
      | available_balance | biller_name       | payment_amount | expected_outcome | expected_message                                              |
      | 200.00            | City Electric Co  | 200.01         | Failure          | Insufficient funds. Please reduce the payment amount.        |
      | 200.00            | City Electric Co  | 5000.00        | Failure          | Insufficient funds. Please reduce the payment amount.        |
      | 200.00            | City Electric Co  | 999999.99      | Failure          | Insufficient funds. Please reduce the payment amount.        |

    Examples: Invalid Payment Amount Boundary Values
      | available_balance | biller_name       | payment_amount | expected_outcome | expected_message                                              |
      | 5000.00           | City Electric Co  | 0.00           | Failure          | Payment amount must be greater than zero.                    |
      | 5000.00           | City Electric Co  |                | Failure          | Payment amount is required.                                  |
      | 5000.00           | City Electric Co  | -1.00          | Failure          | Payment amount must be a positive value.                     |

  # ============================================================
  # SCENARIO 5: Card Controls — Security and Access Control Validation
  # ============================================================
  @regression @negative @security @high @ui @api @story-CARD-001
  Scenario: Prevent unauthorised access to another customer's card controls
    Given the customer "bob.tanaka@example.com" is authenticated on the dashboard
    And customer "alice.mercer@example.com" holds card linked to account "ACC-10010001"
    When "bob.tanaka@example.com" attempts to access the card controls for account "ACC-10010001" belonging to "alice.mercer@example.com"
    Then access should be denied
    And the error message "You are not authorised to manage this account." should be displayed
    And a security event should be recorded in the audit log for the attempted unauthorised access
    But no card details belonging to "alice.mercer@example.com" should be exposed

  # ============================================================
  # BONUS — Inline within feature: SQL Injection Security Test
  # ============================================================
  @regression @negative @security @critical @ui @api @story-SEC-001
  Scenario: Reject SQL injection payload in the login email field
    Given the login page is accessible to unauthenticated users
    When an unauthenticated user submits the login form with a malicious payload:
      | Field    | Value              |
      | Email    | ' OR '1'='1' --    |
      | Password | anything           |
    Then authentication should be denied
    And the error message "Invalid email or password." should be displayed
    And no customer account data should be returned or exposed
    But the injection payload should be recorded in the security event log for analyst review | online_banking.feature |
