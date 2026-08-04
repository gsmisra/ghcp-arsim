import * as vscode from 'vscode';
import { GithubFileContent, GithubFileKind, GithubFileRef } from '../types';

/**
 * All Skills / Instructions / Prompts live under `.github/<kind>/` in the
 * first workspace folder, mirroring the folder conventions GitHub Copilot
 * itself uses for custom instructions (`.github/instructions/*.instructions.md`)
 * and prompt files (`.github/prompts/*.prompt.md`). Skills use the same
 * pattern under `.github/skills/`.
 */
const FOLDER_BY_KIND: Record<GithubFileKind, string> = {
  skill: 'skills',
  instruction: 'instructions',
  prompt: 'prompts',
};

export function githubFolderFor(kind: GithubFileKind): string {
  return `.github/${FOLDER_BY_KIND[kind]}`;
}

function getWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

async function listMarkdownFiles(kind: GithubFileKind): Promise<GithubFileRef[]> {
  const root = getWorkspaceRoot();
  if (!root) return [];

  const pattern = new vscode.RelativePattern(root, `${githubFolderFor(kind)}/**/*.md`);
  const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

  return uris
    .map((uri) => ({
      kind,
      relativePath: vscode.workspace.asRelativePath(uri, false),
      fileName: uri.path.split('/').pop() || uri.fsPath,
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export async function listSkills(): Promise<GithubFileRef[]> {
  return listMarkdownFiles('skill');
}

export async function listInstructions(): Promise<GithubFileRef[]> {
  return listMarkdownFiles('instruction');
}

export async function listPrompts(): Promise<GithubFileRef[]> {
  return listMarkdownFiles('prompt');
}

export async function readGithubFile(
  ref: GithubFileRef,
  maxChars: number
): Promise<GithubFileContent> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  const uri = vscode.Uri.joinPath(root.uri, ref.relativePath);
  const bytes = await vscode.workspace.fs.readFile(uri);
  const full = Buffer.from(bytes).toString('utf-8');
  const truncated = full.length > maxChars;
  return {
    ...ref,
    content: truncated ? full.slice(0, maxChars) : full,
    truncated,
  };
}

export async function writeGithubFile(
  kind: GithubFileKind,
  fileName: string,
  content: string
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('Open a workspace folder before saving files to .github/.');
  }
  const safeName = fileName.trim();
  if (!safeName || safeName.includes('..') || /[\\/]/.test(safeName)) {
    throw new Error(`Invalid file name: "${fileName}"`);
  }

  const folderUri = vscode.Uri.joinPath(root.uri, githubFolderFor(kind));
  await vscode.workspace.fs.createDirectory(folderUri);

  const fileUri = vscode.Uri.joinPath(folderUri, safeName);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
  return vscode.workspace.asRelativePath(fileUri, false);
}
