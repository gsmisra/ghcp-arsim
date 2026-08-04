import { WizardSchema } from '../types';

/**
 * Step-by-step field definitions driving the "Add New Skill / Instruction /
 * Prompt" wizards. One field group per step so the webview can render a
 * "Next ->" / "Back" flow generically, without workflow-specific UI code.
 * The field `key`s here are also the section keys used by markdownRenderer.ts.
 */

const skillWizard: WizardSchema = {
  kind: 'skill',
  title: 'Add New Skill',
  steps: [
    {
      title: 'Identity',
      description: 'Name this skill and give it a one-line purpose.',
      fields: [
        { key: 'name', label: 'Skill Name', type: 'text', required: true, placeholder: 'e.g. API Contract Regression Review' },
        { key: 'description', label: 'Short Description / Purpose', type: 'textarea', required: true, placeholder: 'What does this skill teach Copilot to do?' },
      ],
    },
    {
      title: 'Applicability',
      description: 'When should this skill be applied?',
      fields: [
        { key: 'whenToUse', label: 'When To Use / Trigger Conditions', type: 'textarea', required: true, placeholder: 'e.g. When reviewing changes to REST controllers or OpenAPI specs' },
        { key: 'scope', label: 'Applicable Scope (file types / languages / directories)', type: 'text', placeholder: 'e.g. **/*.java, api/**' },
      ],
    },
    {
      title: 'Procedure',
      description: 'The step-by-step approach to follow.',
      fields: [
        { key: 'procedure', label: 'Step-by-Step Procedure', type: 'textarea', required: true, placeholder: '1. ...\n2. ...\n3. ...' },
        { key: 'toolsRequired', label: 'Required Tools / Permissions', type: 'textarea', placeholder: 'e.g. Read access to OpenAPI spec, no external network calls' },
      ],
    },
    {
      title: 'Inputs & Outputs',
      description: 'What this skill expects and what it produces.',
      fields: [
        { key: 'inputs', label: 'Inputs Expected', type: 'textarea', placeholder: 'e.g. Diff of controller files, existing OpenAPI spec' },
        { key: 'outputs', label: 'Outputs Produced', type: 'textarea', placeholder: 'e.g. List of breaking API changes with severity' },
      ],
    },
    {
      title: 'Worked Example',
      description: 'A concrete example anchors model behavior far better than abstract rules.',
      fields: [
        { key: 'exampleInput', label: 'Example Input', type: 'textarea', placeholder: 'Paste a representative input' },
        { key: 'exampleOutput', label: 'Example Output', type: 'textarea', placeholder: 'Paste the expected output for that input' },
      ],
    },
    {
      title: 'Boundaries',
      description: 'Edge cases and things this skill must never do.',
      fields: [
        { key: 'edgeCases', label: 'Edge Cases & Constraints', type: 'textarea' },
        { key: 'antiPatterns', label: 'Anti-Patterns / Do NOT', type: 'textarea', placeholder: 'e.g. Do not modify production configuration files' },
      ],
    },
    {
      title: 'Metadata',
      description: 'Ownership and versioning for governance/audit.',
      fields: [
        { key: 'relatedLinks', label: 'Related Skills / Instructions / Links', type: 'text' },
        { key: 'owner', label: 'Owner / Author', type: 'text', required: true },
        { key: 'version', label: 'Version', type: 'text', defaultValue: '1.0.0' },
        { key: 'reviewNotes', label: 'Review Notes (optional)', type: 'textarea' },
      ],
    },
  ],
};

const instructionWizard: WizardSchema = {
  kind: 'instruction',
  title: 'Add New Instruction',
  steps: [
    {
      title: 'Identity',
      description: 'Name this instruction set and its purpose.',
      fields: [
        { key: 'name', label: 'Instruction Set Name', type: 'text', required: true, placeholder: 'e.g. Payment Service Coding Standards' },
        { key: 'description', label: 'Description / Purpose', type: 'textarea', required: true },
      ],
    },
    {
      title: 'Applicability',
      description: 'Which files should Copilot apply this to?',
      fields: [
        { key: 'applyTo', label: 'Apply To (glob pattern)', type: 'text', required: true, placeholder: 'e.g. services/payments/**/*.ts' },
        { key: 'scopeContext', label: 'Scope & Context', type: 'textarea', placeholder: 'Which project/module/team does this apply to?' },
      ],
    },
    {
      title: 'Standards',
      description: 'Coding standards and required patterns.',
      fields: [
        { key: 'codingStandards', label: 'Coding Standards & Conventions', type: 'textarea' },
        { key: 'requiredPatterns', label: 'Required Patterns / Architecture Rules', type: 'textarea' },
      ],
    },
    {
      title: 'Do / Don\'t',
      description: 'Explicit dos and don\'ts remove ambiguity.',
      fields: [
        { key: 'dos', label: "Do's", type: 'textarea' },
        { key: 'donts', label: "Don'ts", type: 'textarea' },
      ],
    },
    {
      title: 'Compliance',
      description: 'Banking-specific security and audit requirements.',
      fields: [
        { key: 'securityCompliance', label: 'Security & Compliance Requirements', type: 'textarea', placeholder: 'e.g. PII masking, secrets handling, audit logging' },
        { key: 'testingExpectations', label: 'Testing Expectations', type: 'textarea' },
      ],
    },
    {
      title: 'Examples',
      description: 'Show, don\'t just tell.',
      fields: [
        { key: 'goodExample', label: 'Example (Good)', type: 'textarea' },
        { key: 'badExample', label: 'Example (Bad)', type: 'textarea' },
      ],
    },
    {
      title: 'Metadata',
      description: 'Ownership and versioning for governance/audit.',
      fields: [
        { key: 'references', label: 'References / Links', type: 'text' },
        { key: 'owner', label: 'Owner / Author', type: 'text', required: true },
        { key: 'version', label: 'Version', type: 'text', defaultValue: '1.0.0' },
      ],
    },
  ],
};

const promptWizard: WizardSchema = {
  kind: 'prompt',
  title: 'Add New Prompt',
  steps: [
    {
      title: 'Identity',
      description: 'Name this prompt and describe what it does.',
      fields: [
        { key: 'name', label: 'Prompt Name / File Name', type: 'text', required: true, placeholder: 'e.g. sev1-incident-summary' },
        { key: 'description', label: 'Description', type: 'textarea', required: true },
      ],
    },
    {
      title: 'Configuration',
      description: 'How should this prompt be run?',
      fields: [
        {
          key: 'mode',
          label: 'Mode',
          type: 'select',
          options: [
            { value: 'ask', label: 'Ask' },
            { value: 'edit', label: 'Edit' },
            { value: 'agent', label: 'Agent' },
          ],
          defaultValue: 'ask',
        },
        { key: 'targetModel', label: 'Target Model Preference (optional)', type: 'text', placeholder: 'e.g. GPT-4o, Claude Sonnet' },
        { key: 'variables', label: 'Required Variables / Inputs', type: 'textarea', placeholder: 'e.g. {incident_id}, {severity}' },
      ],
    },
    {
      title: 'Prompt Body',
      description: 'The main instructions sent to the model.',
      fields: [
        { key: 'body', label: 'Prompt Body / Instructions', type: 'textarea', required: true },
      ],
    },
    {
      title: 'Output & Constraints',
      description: 'What should come back, and what guardrails apply?',
      fields: [
        { key: 'outputFormat', label: 'Expected Output Format', type: 'textarea' },
        { key: 'constraints', label: 'Constraints / Guardrails', type: 'textarea' },
      ],
    },
    {
      title: 'Example & Metadata',
      description: 'A usage example plus ownership/versioning.',
      fields: [
        { key: 'exampleUsage', label: 'Example Usage', type: 'textarea' },
        { key: 'owner', label: 'Owner / Author', type: 'text', required: true },
        { key: 'version', label: 'Version', type: 'text', defaultValue: '1.0.0' },
      ],
    },
  ],
};

export const WIZARD_SCHEMAS: WizardSchema[] = [skillWizard, instructionWizard, promptWizard];
