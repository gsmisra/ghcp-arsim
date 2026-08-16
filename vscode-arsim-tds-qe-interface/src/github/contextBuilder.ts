import * as vscode from 'vscode';
import { readGithubFile } from './fileDiscovery';
import { ContextSummary, GithubFileRef, RetrievedChunkInfo, WorkflowDefinition } from '../types';

/** A retrieved knowledge-base chunk plus the provenance the UI reports. */
export interface RetrievedChunk {
  label: string;
  content: string;
  info: RetrievedChunkInfo;
}
import { truncateToLastLine } from '../fileIngest/textStats';

/**
 * Rough, widely-used estimate (OpenAI's own guidance for English text) used
 * only to size the *first-pass* character budget before any real tokenizer
 * feedback exists. Never trusted on its own for the final answer -- see the
 * refinement pass below, which corrects against the selected model's real
 * tokenizer once real content is assembled.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Fraction of the model's reported `maxInputTokens` we treat as usable.
 * The remainder is headroom for: our own chars/token estimate being
 * imprecise for this specific content (code, non-English text, and dense
 * data all tokenize differently from average English prose), and for
 * message/role formatting overhead the raw tokenizer count doesn't capture
 * exactly the way the wire format will.
 */
const TOKEN_BUDGET_SAFETY_RATIO = 0.9;

export interface BuildContextParams {
  workflow: WorkflowDefinition;
  userText: string;
  selectedSkills: GithubFileRef[];
  selectedInstructions: GithubFileRef[];
  selectedPromptFile: GithubFileRef | null;
  promptFileContentOverride?: string;
  attachedFile?: { fileName: string; content: string } | null;
  /** Generate Feature File From Jira Story only: the currently-selected
   *  chunks (AC segments, Description, linked tickets, attachments) --
   *  already resolved to plain content host-side by JiraContextStore.
   *  Folded in via the same generic `consume()` every other labeled
   *  section uses, right after Skills/Instructions/Prompt and before the
   *  attached file -- purely additive, no other section's logic changes. */
  jiraChunks?: { label: string; content: string }[];
  /** RAG: the top-K knowledge-base chunks retrieved for this request
   *  (see src/rag/retriever.ts). Placed ahead of the attached file so
   *  that when budget runs short it's the bulk attachment that gets
   *  trimmed, not the specifically-retrieved-as-relevant material.
   *  Omitted entirely when no Knowledge Base is selected, which is what
   *  makes this change a no-op for every pre-RAG code path. */
  retrievedChunks?: RetrievedChunk[];
  /**
   * The selected model's real input-token budget, when known. When
   * provided (with `countTokens`), the total/attached-file character
   * budgets scale to it directly instead of relying solely on the static
   * configured ceilings -- "bigger model -> more of your document gets
   * sent" by design, not just up to a fixed number. Falls back to the
   * static config ceilings when omitted or unavailable.
   */
  modelMaxInputTokens?: number | null;
  /**
   * Counts tokens for a string using the selected model's own tokenizer
   * (`LanguageModelChat.countTokens`). Optional: when omitted, budgeting
   * stays purely character-based (the old behavior). When provided, it's
   * used for one real-token-accurate refinement pass after the initial
   * char-based assembly, specifically re-trimming the attached file
   * (the one section large enough for a rough char/token estimate to
   * meaningfully miss) if the real count comes in over budget.
   */
  countTokens?: (text: string) => Promise<number | null>;
}

/**
 * Builds the exact string sent to the model as the user-turn content.
 *
 * Design intent: only *selected* material is ever read from disk and only
 * *non-empty* sections are emitted. There is no "SELECTED SKILLS: None"
 * filler, no whole-workspace dump, and no unrelated conversation history --
 * this keeps the payload to what the user explicitly opted into, which
 * matters both for token cost and for not confusing the model with noise
 * (and, in a regulated environment, for keeping an auditable, minimal
 * record of exactly what left the editor).
 */
export async function buildContext(
  params: BuildContextParams
): Promise<{ content: string; summary: Omit<ContextSummary, 'modelName'>; promptTokens: number | null }> {
  const config = vscode.workspace.getConfiguration('arsimTdsQe');
  const maxPerFile = config.get<number>('maxContextCharsPerFile', 12000);
  const configuredMaxTotal = config.get<number>('maxTotalContextChars', 120000);
  // Deliberately separate from maxPerFile: that cap is sized for short,
  // curated Skill/Instruction .md files, which stays a fixed governance
  // control regardless of model -- an attached document is a different
  // kind of input and gets its own, model-scalable allowance.
  const configuredMaxAttachedFileChars = config.get<number>('maxAttachedFileContextChars', 200000);

  // The configured values remain hard ceilings (a cost/safety control an
  // admin can still rely on), but when the selected model's real token
  // budget is known, the *effective* budget scales to it -- taking
  // whichever is smaller.
  let effectiveMaxTotal = configuredMaxTotal;
  let effectiveMaxAttachedFileChars = configuredMaxAttachedFileChars;
  let budgetSource: 'model' | 'config' = 'config';
  let usableTokenBudget: number | null = null;

  if (typeof params.modelMaxInputTokens === 'number' && params.modelMaxInputTokens > 0) {
    usableTokenBudget = Math.floor(params.modelMaxInputTokens * TOKEN_BUDGET_SAFETY_RATIO);
    const dynamicCharBudget = usableTokenBudget * CHARS_PER_TOKEN_ESTIMATE;
    effectiveMaxTotal = Math.min(dynamicCharBudget, configuredMaxTotal);
    effectiveMaxAttachedFileChars = Math.min(dynamicCharBudget, configuredMaxAttachedFileChars);
    budgetSource = 'model';
  }

  const truncatedFiles: string[] = [];
  const preSections: string[] = [];
  let budget = effectiveMaxTotal;

  // The user's own request text is reserved *first*, before anything else
  // competes for budget. Skills/Instructions/a Prompt file/an attached
  // document all exist to *support* answering the user's actual request --
  // none of them should be able to crowd it out. Without this, a large
  // attached file on a small-context model could silently consume the
  // entire budget and leave nothing for the request itself.
  const userRequestTrimmed = params.userText.trim();
  let userRequestSection = '';
  if (userRequestTrimmed) {
    const clipped = userRequestTrimmed.length > budget ? userRequestTrimmed.slice(0, budget) : userRequestTrimmed;
    if (clipped.length < userRequestTrimmed.length) {
      truncatedFiles.push('User Request (clipped to fit total budget)');
    }
    userRequestSection = `### User Request\n${clipped}`;
    budget -= clipped.length;
  }

  const consume = (label: string, body: string): boolean => {
    const trimmed = body.trim();
    if (!trimmed) return false;
    if (budget <= 0) {
      truncatedFiles.push(`${label} (omitted -- context budget reached)`);
      return false;
    }
    const clipped = trimmed.length > budget ? trimmed.slice(0, budget) : trimmed;
    if (clipped.length < trimmed.length) {
      truncatedFiles.push(`${label} (clipped to fit total budget)`);
    }
    budget -= clipped.length;
    preSections.push(`### ${label}\n${clipped}`);
    return true;
  };

  let skillsIncluded = 0;
  for (const ref of params.selectedSkills) {
    const file = await readGithubFile(ref, maxPerFile);
    if (file.truncated) truncatedFiles.push(`${file.fileName} (per-file limit)`);
    if (consume(`Skill: ${ref.fileName}`, file.content)) skillsIncluded += 1;
  }

  let instructionsIncluded = 0;
  for (const ref of params.selectedInstructions) {
    const file = await readGithubFile(ref, maxPerFile);
    if (file.truncated) truncatedFiles.push(`${file.fileName} (per-file limit)`);
    if (consume(`Instruction: ${ref.fileName}`, file.content)) instructionsIncluded += 1;
  }

  let usedPromptFile = false;
  if (params.selectedPromptFile) {
    const body =
      params.promptFileContentOverride ??
      (await readGithubFile(params.selectedPromptFile, maxPerFile)).content;
    usedPromptFile = consume(`Custom Prompt: ${params.selectedPromptFile.fileName}`, body);
  }

  let jiraChunksIncluded = 0;
  for (const chunk of params.jiraChunks ?? []) {
    if (consume(`Jira: ${chunk.label}`, chunk.content)) jiraChunksIncluded += 1;
  }

  // Retrieved knowledge-base material, highest-scoring first (the
  // retriever returns them ranked), so if budget runs out mid-list it's
  // the *least* relevant chunks that get dropped.
  let retrievedChunksIncluded = 0;
  const retrievedSources: RetrievedChunkInfo[] = [];
  for (const chunk of params.retrievedChunks ?? []) {
    if (consume(`Knowledge Base: ${chunk.label}`, chunk.content)) {
      retrievedChunksIncluded += 1;
      retrievedSources.push(chunk.info);
    }
  }

  // The attached file gets its own dedicated assembly (rather than going
  // through the generic `consume`) for two reasons: we need to surface the
  // exact last line that made it into the request, and it's the one
  // section we re-trim during the token-accurate refinement pass below.
  let attachedFileName: string | null = null;
  let attachedFileLastLine: string | null = null;
  let attachedFileSection = '';
  const attachedBudgetAfterOthers = budget;

  const buildAttachedSection = (charBudget: number): void => {
    attachedFileSection = '';
    attachedFileLastLine = null;
    if (!params.attachedFile) return;
    const trimmed = params.attachedFile.content.trim();
    if (!trimmed) return;

    attachedFileName = params.attachedFile.fileName;
    const label = `Attached File: ${params.attachedFile.fileName}`;
    if (charBudget <= 0) {
      attachedFileLastLine = '';
      return;
    }
    const perFileClamped =
      trimmed.length > effectiveMaxAttachedFileChars ? trimmed.slice(0, effectiveMaxAttachedFileChars) : trimmed;
    const { clipped, lastLine, truncated } = truncateToLastLine(perFileClamped, charBudget);
    if (truncated || perFileClamped.length < trimmed.length) {
      attachedFileLastLine = lastLine;
    }
    attachedFileSection = `### ${label}\n${clipped}`;
  };

  buildAttachedSection(attachedBudgetAfterOthers);
  if (attachedFileSection) {
    budget -= attachedFileSection.length;
  } else if (params.attachedFile && params.attachedFile.content.trim() && attachedBudgetAfterOthers <= 0) {
    truncatedFiles.push(`Attached File: ${params.attachedFile.fileName} (omitted -- context budget reached)`);
  }

  const assemble = (): string =>
    [...preSections, attachedFileSection, userRequestSection].filter(Boolean).join('\n\n');

  let content = assemble();
  let promptTokens: number | null = null;

  // Token-accurate refinement: the char-based budget above is a first-pass
  // estimate. If we have real tokenizer access, measure the actual cost and,
  // if it's over the model's real budget, shrink specifically the attached
  // file (the one section large enough for the char/token estimate to
  // meaningfully miss) by the measured overage ratio and re-measure once
  // more. Two passes converge close enough in virtually all real cases;
  // any small residual gap is still caught and reported by the live
  // Context Limit meter downstream.
  if (params.countTokens && usableTokenBudget !== null) {
    for (let pass = 0; pass < 2; pass++) {
      const [systemTokens, contentTokens] = await Promise.all([
        params.countTokens(params.workflow.systemPrompt),
        params.countTokens(content),
      ]);
      // countTokens() fails soft to `null` on any error, including a
      // stalled/timed-out vscode.lm call (see copilotClient.ts) -- if
      // BOTH came back null, nothing was actually measured, and reporting
      // that as `promptTokens: 0` would be a confidently wrong answer
      // (the Context Limit meter showing "0%" as if there's genuinely
      // nothing to send, rather than "couldn't tell"). Leave promptTokens
      // as null in that case so the caller can distinguish the two.
      if (systemTokens === null && contentTokens === null) {
        break;
      }
      const total = (systemTokens ?? 0) + (contentTokens ?? 0);
      promptTokens = total;

      if (total <= usableTokenBudget || !attachedFileSection) {
        break;
      }

      const overageRatio = usableTokenBudget / total;
      const currentAttachedChars = attachedFileSection.length;
      // A little extra shrink beyond the raw ratio (0.95x) to avoid needing
      // a third pass in the common case.
      const targetChars = Math.max(0, Math.floor(currentAttachedChars * overageRatio * 0.95));

      if (targetChars >= currentAttachedChars) {
        break; // no meaningful reduction possible; stop rather than loop pointlessly
      }

      truncatedFiles.push(
        `Attached File: ${params.attachedFile?.fileName ?? ''} (reduced further to fit ${params.modelMaxInputTokens ?? '?'} -token model window)`
      );
      buildAttachedSection(targetChars);
      content = assemble();
    }
  }

  return {
    content,
    summary: {
      workflowLabel: params.workflow.label,
      skillsIncluded,
      instructionsIncluded,
      usedPromptFile,
      attachedFileName,
      approxCharsSent: content.length,
      truncatedFiles,
      attachedFileLastLine,
      budgetSource,
      effectiveMaxTotalChars: effectiveMaxTotal,
      jiraChunksIncluded,
      retrievedChunksIncluded,
      retrievedSources,
    },
    promptTokens,
  };
}
