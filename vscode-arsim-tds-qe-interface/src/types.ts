/**
 * Shared type definitions used across the extension host, the webview
 * message protocol, and the workflow/wizard modules.
 *
 * Keeping these in one file gives the extension <-> webview boundary a
 * single source of truth so the message contract can't silently drift.
 */

export type WorkflowId =
  | 'generic'
  | 'test-case-creation'
  | 'automation-script-creation'
  | 'pr-analysis'
  | 'prod-incident-analysis'
  | 'test-failure-analysis'
  | 'generate-feature-file-from-jira-story'
  | 'knowledge-base-qa';

export interface WorkflowDefinition {
  id: WorkflowId;
  label: string;
  description: string;
  /** Sent to the model as the system/role framing message. */
  systemPrompt: string;
  /** Short placeholder shown in the prompt textarea for this workflow. */
  inputPlaceholder: string;
  /**
   * Marks a workflow that pulls its own external data (currently only the
   * ServiceNow-backed PROD Incident Analysis workflow) so the webview can
   * key its UI off workflow metadata instead of hardcoding workflow ids.
   */
  dataSource?: 'servicenow-incidents' | 'jira-issue' | 'knowledge-base';
  /** Workspace-relative .github/... paths auto-selected the moment this
   *  workflow becomes active (and cleanly removed -- not the user's own
   *  picks -- when the user switches away). */
  autoSkillPath?: string;
  autoInstructionPath?: string;
  autoPromptPath?: string;
}

export interface ModelInfo {
  /** Stable composite id: `${vendor}:${id||family}` -- used for selection round-trips. */
  uid: string;
  id: string;
  name: string;
  vendor: string;
  family: string;
}

/**
 * A single ServiceNow `incident` table row, narrowed to the fields this
 * workflow actually uses. Fetched with `sysparm_display_value=true`, so
 * reference/choice fields (severity, priority, state, cmdb_ci,
 * assignment_group) always arrive as plain display strings, never
 * ServiceNow's raw sys_id/value objects.
 */
export interface ServiceNowIncident {
  sys_id: string;
  number: string;
  short_description: string;
  severity: string;
  priority: string;
  state: string;
  sys_created_on: string;
  cmdb_ci?: string;
  assignment_group?: string;
  description?: string;
  work_notes?: string;
  category?: string;
}

/**
 * One selectable piece of a fetched Jira story's context (an Acceptance
 * Criteria segment, the Description, a linked ticket's own AC/description,
 * or a parsed attachment). Deliberately never carries real content to the
 * webview -- only `charCount` and, for an attachment, the same
 * `AttachedFileMeta` shape the Browse-file feature already uses, so the
 * Control panel can render the exact same pdf/docx/csv/xlsx range
 * controls it already has for a real attached file. See
 * src/jira/jiraContextStore.ts for the host-side counterpart that holds
 * the actual content.
 */
export type JiraChunkKind = 'ac' | 'description' | 'linked-ticket' | 'attachment';

export interface JiraChunkMeta {
  id: string;
  label: string;
  kind: JiraChunkKind;
  charCount: number;
  /** attachment chunks only. */
  attachmentMeta?: AttachedFileMeta;
}

/**
 * Knowledge Base (RAG). A KB is a named collection of plain-text
 * documents that get chunked and BM25-indexed for retrieval -- see
 * src/knowledgeBase/knowledgeBaseStore.ts and src/rag/.
 *
 * Three storage tiers, all listed together in the UI and distinguishable
 * by `tier`. Ids are tier-namespaced (`workspace:payments-runbook`) so
 * two tiers can never collide:
 *   - 'bundled'   read-only, ships inside the .vsix
 *   - 'workspace' .arsim-knowledge-base/ in the workspace (git-shareable)
 *   - 'user'      the extension's private globalStorage (personal)
 */
export type KnowledgeBaseTier = 'bundled' | 'workspace' | 'user';

export interface KbDocument {
  id: string;
  title: string;
  text: string;
  /** Where the text came from, when imported from a file. */
  sourcePath?: string;
  addedAt: string; // ISO 8601
}

export interface KnowledgeBase {
  /** Tier-namespaced, e.g. "workspace:payments-runbook". */
  id: string;
  tier: KnowledgeBaseTier;
  name: string;
  description: string;
  documents: KbDocument[];
}

/** What the webview sees -- never the document text itself, only enough
 *  to render the picker and the per-KB document list. */
export interface KnowledgeBaseMeta {
  id: string;
  tier: KnowledgeBaseTier;
  name: string;
  description: string;
  /** Read-only KBs (the bundled tier) can't accept new documents. */
  readOnly: boolean;
  documents: { id: string; title: string; charCount: number }[];
  totalChars: number;
}

/** One retrieved chunk, surfaced back to the UI so the user can see
 *  exactly which knowledge-base material grounded an answer. */
export interface RetrievedChunkInfo {
  knowledgeBaseName: string;
  documentTitle: string;
  score: number;
  charCount: number;
}

export type GithubFileKind = 'skill' | 'instruction' | 'prompt';

export interface GithubFileRef {
  kind: GithubFileKind;
  /** Relative path, e.g. .github/skills/api-contract-review.md for a
   *  workspace file, or skills/prod-incident-analysis.skill.md (relative
   *  to the extension's own bundled resources/seed-github/) for a
   *  built-in one -- see `source`. */
  relativePath: string;
  /** File name only, shown in the UI list. */
  fileName: string;
  /** 'workspace' (default when omitted, for backward compatibility) reads
   *  from the open workspace's .github/ folder, same as always.
   *  'bundled' reads from this extension's own packaged seed content
   *  (resources/seed-github/), available even with no matching workspace
   *  file or no workspace open at all -- see fileDiscovery.ts. Editing a
   *  bundled file and saving always writes to the workspace, which then
   *  shadows the bundled copy from then on. */
  source?: 'workspace' | 'bundled';
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

/**
 * Token accounting for a single request. Counts come from the selected
 * model's own tokenizer via `vscode.lm`'s `LanguageModelChat.countTokens`
 * -- the same tokenizer the model itself uses -- so these are real counts
 * for that model, not a generic/approximate estimate.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Running totals across every request sent in this VS Code install (persisted). */
export interface SessionTokenTotals {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * One row of durable token-usage history. Captured in memory as each chat
 * request completes and flushed to a local JSON file under the extension's
 * global storage directory -- so "closing the extension" (window reload,
 * VS Code shutdown, machine restart) never loses data, without requiring a
 * clean-shutdown hook to fire.
 */
export interface TokenHistoryEntry {
  timestamp: string; // ISO 8601
  hostname: string;
  workflowId: WorkflowId;
  workflowLabel: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type AttachedFileKind = 'pdf' | 'docx' | 'csv' | 'xlsx' | 'text';

/**
 * Static facts about a file the user picked via Browse, sent once right
 * after parsing so the "Control the data sent in the context" panel can
 * render the right controls for the detected type (page range for
 * pdf/docx, column+row range for csv, per-sheet column+row range for
 * xlsx). Never includes the file's actual content -- that stays server
 * side and is only summarized via `AttachedFilePreview`.
 */
export interface AttachedFileMeta {
  fileId: string;
  fileName: string;
  kind: AttachedFileKind;
  /** pdf: exact page count. docx: an approximation, see `approxPageBreaks`. */
  pageCount?: number;
  /** docx only: count of manual page-break markers found in the document XML.
   *  Word does not store real page boundaries in .docx (pagination is computed
   *  at render/print time), so any "page" concept here is a labeled approximation. */
  approxPageBreaks?: number;
  totalLines?: number; // text
  csvColumns?: string[];
  csvTotalRows?: number;
  sheets?: { name: string; columns: string[]; totalRows: number }[]; // xlsx
  /**
   * Set when parsing succeeded but found little or no usable content --
   * most commonly a scanned/image-based PDF (no text layer for pdfjs to
   * extract; that needs OCR, which this extension does not do) or an
   * otherwise-empty document/spreadsheet. Surfaced in the UI *before* the
   * user sends, rather than letting them discover it from a confused model
   * reply after the fact.
   */
  warning?: string | null;
  /** Set only for a synthetic "attached file" built from a ServiceNow
   *  incident fetch (see serviceNow/serviceNowIngest.ts) rather than a
   *  real picked file -- lets the Control panel render the ticket-checkbox
   *  table instead of the generic CSV column/row-range controls. */
  sourceKind?: 'servicenow-incidents';
  /** Compact per-incident rows for the Control panel's checkbox table.
   *  Only set alongside sourceKind: 'servicenow-incidents'. */
  incidentSummary?: { number: string; shortDescription: string; severity: string }[];
}

/** User-chosen slice of an attached file's content to actually send. */
export interface FileSelection {
  pageFrom?: number; // pdf (exact) / docx (approximate)
  pageTo?: number;
  lineFrom?: number; // generic text
  lineTo?: number;
  csvColumns?: string[]; // empty/omitted = all columns
  csvRowFrom?: number;
  csvRowTo?: number;
  sheetSelections?: Record<string, { columns?: string[]; rowFrom?: number; rowTo?: number }>;
  /** ServiceNow incidents only: incident numbers checked in the Control
   *  panel's ticket table. Empty/omitted = include every fetched incident. */
  selectedIncidentNumbers?: string[];
}

/** Result of applying a FileSelection: what will actually be sent. */
export interface AttachedFilePreview {
  fileId: string;
  charCount: number;
  lineCount: number;
  lastLineIncluded: string;
}

/** Extension -> Webview messages */
export type HostMessage =
  | { type: 'init'; workflows: WorkflowDefinition[]; defaultWorkflow: WorkflowId; wizards: WizardSchema[] }
  | { type: 'models'; models: ModelInfo[]; error?: string }
  | { type: 'files'; skills: GithubFileRef[]; instructions: GithubFileRef[]; prompts: GithubFileRef[] }
  | { type: 'promptContent'; file: GithubFileRef; content: string }
  | { type: 'streamStart'; requestId: string }
  | { type: 'streamChunk'; requestId: string; text: string }
  | { type: 'promptTokenCounted'; requestId: string; promptTokens: number }
  | { type: 'streamDone'; requestId: string; contextSummary: ContextSummary; usage: TokenUsage; session: SessionTokenTotals }
  | { type: 'streamError'; requestId: string; message: string }
  | { type: 'testConnectionResult'; ok: boolean; model?: string; response?: string; error?: string; usage?: TokenUsage }
  | { type: 'wizardSaved'; kind: GithubFileKind; relativePath: string }
  | { type: 'wizardError'; message: string }
  | { type: 'tokenSession'; session: SessionTokenTotals }
  | { type: 'tokenHistory'; entries: TokenHistoryEntry[] }
  | { type: 'fileParsing' }
  | { type: 'fileAttached'; meta: AttachedFileMeta; preview: AttachedFilePreview }
  | { type: 'fileSelectionUpdated'; preview: AttachedFilePreview }
  | { type: 'fileAttachError'; message: string }
  | { type: 'fileCleared' }
  | {
      type: 'contextMeter';
      usedTokens: number;
      maxTokens: number | null;
      exceeded: boolean;
      lastLineIncluded: string | null;
    }
  | { type: 'managedFileContent'; kind: GithubFileKind; file: GithubFileRef; content: string }
  | { type: 'incidentSearchBusy' }
  | { type: 'incidentSearchResult'; count: number; query: string }
  | { type: 'incidentSearchError'; message: string }
  | { type: 'jiraTicketFetched'; ticketKey: string; summary: string; chunks: JiraChunkMeta[] }
  | { type: 'jiraTicketError'; message: string }
  | { type: 'jiraChunkContentUpdated'; chunkId: string; charCount: number }
  | { type: 'featureFileSaved'; path: string }
  | { type: 'featureFileSaveError'; message: string }
  | { type: 'knowledgeBases'; knowledgeBases: KnowledgeBaseMeta[] }
  | { type: 'knowledgeBaseError'; message: string }
  | { type: 'knowledgeBaseImporting' }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'modelAutoSwitched'; modelUid: string; modelName: string; fromModelUid: string };

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
      attachedFileId: string | null;
      /** Generate Feature File From Jira Story only: ids of the currently
       *  checked JiraChunkMeta entries, read live at send/estimate time --
       *  same "selection lives in webview state, read fresh on every call"
       *  pattern already used for selectedSkills/selectedInstructions. */
      jiraChunkIds?: string[] | null;
      /** RAG: ids of the Knowledge Bases currently ticked. Read live at
       *  send/estimate time, same as selectedSkills -- when non-empty the
       *  host retrieves the top-K most relevant chunks for `userText` and
       *  injects them. Empty/omitted means no retrieval runs at all, so
       *  every pre-RAG code path is untouched. */
      selectedKnowledgeBaseIds?: string[] | null;
    }
  | { type: 'testConnection'; modelUid: string }
  | { type: 'saveWizardFile'; kind: GithubFileKind; data: Record<string, string> }
  | { type: 'resetTokenSession' }
  | { type: 'loadTokenHistory' }
  | { type: 'clearTokenHistory' }
  | { type: 'exportTokenHistoryCsv'; entries: TokenHistoryEntry[] }
  | { type: 'browseFile' }
  | { type: 'updateFileSelection'; fileId: string; selection: FileSelection }
  | { type: 'clearAttachedFile'; fileId: string }
  | {
      type: 'estimateContext';
      workflowId: WorkflowId;
      modelUid: string;
      userText: string;
      selectedSkills: GithubFileRef[];
      selectedInstructions: GithubFileRef[];
      selectedPromptFile: GithubFileRef | null;
      attachedFileId: string | null;
      jiraChunkIds?: string[] | null;
      /** RAG: ids of the Knowledge Bases currently ticked. Read live at
       *  send/estimate time, same as selectedSkills -- when non-empty the
       *  host retrieves the top-K most relevant chunks for `userText` and
       *  injects them. Empty/omitted means no retrieval runs at all, so
       *  every pre-RAG code path is untouched. */
      selectedKnowledgeBaseIds?: string[] | null;
    }
  | { type: 'loadManagedFile'; kind: GithubFileKind; file: GithubFileRef }
  | { type: 'saveManagedFile'; kind: GithubFileKind; file: GithubFileRef | null; fileName: string; content: string }
  | { type: 'fetchIncidents'; malCodes: string[]; dateFrom: string; dateTo: string }
  | { type: 'downloadIncidentAnalysisCsv'; headers: string[]; rows: string[][] }
  | { type: 'jiraFetchTicket'; site: 'jtmf' | 'track'; username: string; password: string; ticketUrl: string }
  | { type: 'updateJiraAttachmentSelection'; chunkId: string; selection: FileSelection }
  | { type: 'saveFeatureFile'; relativePath: string; fileNameHint: string; content: string }
  | { type: 'listKnowledgeBases' }
  | { type: 'createKnowledgeBase'; tier: 'workspace' | 'user'; name: string; description: string }
  | { type: 'deleteKnowledgeBase'; knowledgeBaseId: string }
  | { type: 'importKnowledgeBaseDocument'; knowledgeBaseId: string }
  | { type: 'removeKnowledgeBaseDocument'; knowledgeBaseId: string; documentId: string }
  | { type: 'importConfluencePage'; knowledgeBaseId: string };

export interface ContextSummary {
  modelName: string;
  workflowLabel: string;
  skillsIncluded: number;
  instructionsIncluded: number;
  usedPromptFile: boolean;
  attachedFileName: string | null;
  approxCharsSent: number;
  truncatedFiles: string[];
  /** Last full line of the attached file's content that fit within budget, when truncated. */
  attachedFileLastLine: string | null;
  /** Whether the total/attached-file character budget this request used was
   *  derived from the selected model's real token window, or fell back to
   *  the static configured ceiling (e.g. the model didn't report maxInputTokens). */
  budgetSource: 'model' | 'config';
  /** The effective total character budget actually applied for this request. */
  effectiveMaxTotalChars: number;
  /** Generate Feature File From Jira Story only: how many selected Jira
   *  chunks (AC segments/Description/linked tickets/attachments) made it
   *  into the request. 0 for every other workflow. */
  jiraChunksIncluded: number;
  /** RAG: how many retrieved knowledge-base chunks made it into the
   *  request, and which document each came from. 0/[] when no Knowledge
   *  Base was selected. Surfaced in the UI so it's always auditable which
   *  KB material grounded a given answer. */
  retrievedChunksIncluded: number;
  retrievedSources: RetrievedChunkInfo[];
}
