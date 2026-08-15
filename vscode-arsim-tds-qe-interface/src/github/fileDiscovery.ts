import * as vscode from 'vscode';
import { GithubFileContent, GithubFileKind, GithubFileRef } from '../types';

/**
 * All Skills / Instructions / Prompts live under `.github/<kind>/` in the
 * first workspace folder, mirroring the folder conventions GitHub Copilot
 * itself uses for custom instructions (`.github/instructions/*.instructions.md`)
 * and prompt files (`.github/prompts/*.prompt.md`). Skills use the same
 * pattern under `.github/skills/`.
 *
 * On top of a user's own workspace files, this extension also ships a
 * curated, editable set of Skills/Instructions/Prompts *inside the .vsix
 * itself* (resources/seed-github/<kind>/ -- populated at build time by
 * esbuild.js's copySeedGithubContent()), so every install is immediately
 * useful even in a workspace with no .github/ folder of its own, or with
 * no workspace open at all. See listMarkdownFiles() for how the two are
 * merged, and readGithubFile()/writeGithubFile() for how a bundled file
 * behaves when the user edits and saves it.
 */
const FOLDER_BY_KIND: Record<GithubFileKind, string> = {
  skill: 'skills',
  instruction: 'instructions',
  prompt: 'prompts',
};

export function githubFolderFor(kind: GithubFileKind): string {
  return `.github/${FOLDER_BY_KIND[kind]}`;
}

/** Set once during activation (see extension.ts) so the bundled-content
 *  scan knows where this extension is actually installed. */
let extensionUri: vscode.Uri | undefined;

export function initFileDiscovery(uri: vscode.Uri): void {
  extensionUri = uri;
}

function bundledSeedRoot(kind: GithubFileKind): vscode.Uri | undefined {
  if (!extensionUri) return undefined;
  return vscode.Uri.joinPath(extensionUri, 'resources', 'seed-github', FOLDER_BY_KIND[kind]);
}

function getWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

async function listWorkspaceMarkdownFiles(kind: GithubFileKind): Promise<GithubFileRef[]> {
  const root = getWorkspaceRoot();
  if (!root) return [];

  const pattern = new vscode.RelativePattern(root, `${githubFolderFor(kind)}/**/*.md`);
  const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

  return uris.map((uri) => ({
    kind,
    relativePath: vscode.workspace.asRelativePath(uri, false),
    fileName: uri.path.split('/').pop() || uri.fsPath,
    source: 'workspace' as const,
  }));
}

/** Scans this extension's own bundled seed content -- independent of any
 *  workspace, so it works even when none is open. Returns [] (not an
 *  error) when the bundled folder is missing for this kind, which is the
 *  normal case for a dev build that hasn't run the esbuild copy step yet. */
async function listBundledMarkdownFiles(kind: GithubFileKind): Promise<GithubFileRef[]> {
  const dirUri = bundledSeedRoot(kind);
  if (!dirUri) return [];

  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.md'))
      .map(([name]) => ({
        kind,
        relativePath: `${FOLDER_BY_KIND[kind]}/${name}`,
        fileName: name,
        source: 'bundled' as const,
      }));
  } catch {
    // Bundled seed directory doesn't exist for this kind -- not an error.
    return [];
  }
}

/** Merges workspace files with this extension's bundled seed content. A
 *  workspace file always wins over a same-named bundled one -- that's the
 *  user's own customized/overridden copy (created the moment they edit a
 *  bundled item and hit Save, via writeGithubFile() below, which always
 *  targets the workspace). */
async function listMarkdownFiles(kind: GithubFileKind): Promise<GithubFileRef[]> {
  const [workspaceFiles, bundledFiles] = await Promise.all([
    listWorkspaceMarkdownFiles(kind),
    listBundledMarkdownFiles(kind),
  ]);
  const workspaceNames = new Set(workspaceFiles.map((f) => f.fileName));
  const merged = [...workspaceFiles, ...bundledFiles.filter((f) => !workspaceNames.has(f.fileName))];
  return merged.sort((a, b) => a.fileName.localeCompare(b.fileName));
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
  const uri = ref.source === 'bundled' ? resolveBundledFileUri(ref) : resolveWorkspaceFileUri(ref.relativePath);

  const bytes = await vscode.workspace.fs.readFile(uri);
  const full = Buffer.from(bytes).toString('utf-8');
  const truncated = full.length > maxChars;
  return {
    ...ref,
    content: truncated ? full.slice(0, maxChars) : full,
    truncated,
  };
}

function resolveWorkspaceFileUri(relativePath: string): vscode.Uri {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open.');
  }
  return vscode.Uri.joinPath(root.uri, relativePath);
}

function resolveBundledFileUri(ref: GithubFileRef): vscode.Uri {
  const dir = bundledSeedRoot(ref.kind);
  if (!dir) {
    throw new Error('Bundled content is not available.');
  }
  return vscode.Uri.joinPath(dir, ref.fileName);
}

/** Always writes to the open workspace, regardless of whether the file
 *  being edited started out as a bundled (built-in) one or a workspace
 *  one -- this extension's own install directory is read-only after
 *  packaging anyway, so "editing a built-in Skill/Instruction/Prompt and
 *  saving" naturally creates a workspace-local override, which
 *  listMarkdownFiles() above will then always prefer over the bundled
 *  version for the rest of the session. */
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
