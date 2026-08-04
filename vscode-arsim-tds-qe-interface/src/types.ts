/**
 * Shared type definitions used across the extension host, the webview
 * message protocol, and the workflow/wizard modules.
 *
 * Keeping these in one file gives the extension <-> webview boundary a
 * single source of truth so the message contract can't silently drift.
 */

export type WorkflowId =
  | 'test-case-creation'
  | 'automation-script-creation'
  | 'pr-analysis'
  | 'prod-incident-analysis'
  | 'test-failure-analysis';

export interface WorkflowDefinition {
  id: WorkflowId;
  label: string;
  description: string;
  /** Sent to the model as the system/role framing message. */
  systemPrompt: string;
  /** Short placeholder shown in the prompt textarea for this workflow. */
  inputPlaceholder: string;
}

export interface ModelInfo {
  /** Stable composite id: `${vendor}:${id||family}` -- used for selection round-trips. */
  uid: string;
  id: string;
  name: string;
  vendor: string;
  family: string;
}

export type GithubFileKind = 'skill' | 'instruction' | 'prompt';

export interface GithubFileRef {
  kind: GithubFileKind;
  /** Workspace-relative path, e.g. .github/skills/api-contract-review.md */
  relativePath: string;
  /** File name only, shown in the UI list. */
  fileName: string;
}

export interface GithubFileContent extends GithubFileRef {
  content: string;
  truncated: boolean;
}

export type WizardFieldType = 'text' | 'textarea' | 'select' | 'list';

export interface WizardFieldSchema {
  key: string;
  label: string;
  type: WizardFieldType;
  help?: string;
  placeholder?: string;
  required?: boolean;
  /** For type: 'select' */
  options?: { value: string; label: string }[];
  /** For type: 'list' -- rendered as one-item-per-line textarea, split into an array on save. */
  defaultValue?: string;
}

export interface WizardStepSchema {
  title: string;
  description: string;
  fields: WizardFieldSchema[];
}

export interface WizardSchema {
  kind: GithubFileKind;
  title: string;
  steps: WizardStepSchema[];
}

/** Extension -> Webview messages */
export type HostMessage =
  | { type: 'init'; workflows: WorkflowDefinition[]; defaultWorkflow: WorkflowId; wizards: WizardSchema[] }
  | { type: 'models'; models: ModelInfo[]; error?: string }
  | { type: 'files'; skills: GithubFileRef[]; instructions: GithubFileRef[]; prompts: GithubFileRef[] }
  | { type: 'promptContent'; file: GithubFileRef; content: string }
  | { type: 'streamStart'; requestId: string }
  | { type: 'streamChunk'; requestId: string; text: string }
  | { type: 'streamDone'; requestId: string; contextSummary: ContextSummary }
  | { type: 'streamError'; requestId: string; message: string }
  | { type: 'testConnectionResult'; ok: boolean; model?: string; response?: string; error?: string }
  | { type: 'wizardSaved'; kind: GithubFileKind; relativePath: string }
  | { type: 'wizardError'; message: string }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; message: string };

/** Webview -> Extension messages */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'listModels' }
  | { type: 'refreshFiles' }
  | { type: 'loadPrompt'; file: GithubFileRef }
  | { type: 'savePrompt'; file: GithubFileRef | null; fileName: string; content: string }
  | {
      type: 'sendPrompt';
      requestId: string;
      workflowId: WorkflowId;
      modelUid: string;
      userText: string;
      selectedSkills: GithubFileRef[];
      selectedInstructions: GithubFileRef[];
      selectedPromptFile: GithubFileRef | null;
    }
  | { type: 'testConnection'; modelUid: string }
  | { type: 'saveWizardFile'; kind: GithubFileKind; data: Record<string, string> };

export interface ContextSummary {
  modelName: string;
  workflowLabel: string;
  skillsIncluded: number;
  instructionsIncluded: number;
  usedPromptFile: boolean;
  approxCharsSent: number;
  truncatedFiles: string[];
}
