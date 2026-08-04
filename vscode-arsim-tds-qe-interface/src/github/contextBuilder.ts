import * as vscode from 'vscode';
import { readGithubFile } from './fileDiscovery';
import { ContextSummary, GithubFileRef, WorkflowDefinition } from '../types';

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
export async function buildContext(params: {
  workflow: WorkflowDefinition;
  userText: string;
  selectedSkills: GithubFileRef[];
  selectedInstructions: GithubFileRef[];
  selectedPromptFile: GithubFileRef | null;
  promptFileContentOverride?: string;
}): Promise<{ content: string; summary: Omit<ContextSummary, 'modelName'> }> {
  const config = vscode.workspace.getConfiguration('arsimTdsQe');
  const maxPerFile = config.get<number>('maxContextCharsPerFile', 12000);
  const maxTotal = config.get<number>('maxTotalContextChars', 48000);

  const truncatedFiles: string[] = [];
  const sections: string[] = [];
  let budget = maxTotal;

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
    sections.push(`### ${label}\n${clipped}`);
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

  consume('User Request', params.userText);

  const content = sections.join('\n\n');

  return {
    content,
    summary: {
      workflowLabel: params.workflow.label,
      skillsIncluded,
      instructionsIncluded,
      usedPromptFile,
      approxCharsSent: content.length,
      truncatedFiles,
    },
  };
}
