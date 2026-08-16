import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { KbDocument, KnowledgeBase, KnowledgeBaseMeta, KnowledgeBaseTier } from '../types';

/**
 * Three-tier Knowledge Base storage, JSON-file backed.
 *
 * WHY FILES AND NOT A REAL DATABASE
 * ---------------------------------
 * SQLite (better-sqlite3 / node:sqlite) would mean either native
 * bindings -- which break this extension's esbuild-only, no-node_modules
 * bundle and its clean cross-platform packaging -- or a Node version this
 * extension can't assume VS Code ships. A KB here is a few dozen
 * documents read into memory once and indexed; a query engine buys us
 * nothing that a plain JSON array doesn't. This is the same reasoning and
 * the same on-disk approach already proven by TokenHistoryStore
 * (src/telemetry/tokenHistoryStore.ts).
 *
 * The three tiers, all merged into one list in the UI:
 *   bundled   resources/seed-knowledge-base/*.json inside the .vsix.
 *             Read-only (the install directory is read-only post-install).
 *   workspace <workspace>/.arsim-knowledge-base/*.json. Git-committable,
 *             so a curated KB is reviewable and shared with the team.
 *   user      globalStorageUri/knowledge-base/*.json. Private to this
 *             install, survives switching workspaces.
 *
 * Ids are tier-namespaced ("workspace:payments-runbook") so the same file
 * name in two tiers is simply two different KBs rather than a collision
 * that needs precedence rules.
 */

const WORKSPACE_DIR = '.arsim-knowledge-base';

export class KnowledgeBaseStore {
  /** id -> KB, rebuilt by refresh(). */
  private cache = new Map<string, KnowledgeBase>();
  /** Bumped whenever any KB's content changes, so the retriever knows to
   *  drop its BM25 indexes rather than serving stale results. */
  private revisionCounter = 0;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get revision(): number {
    return this.revisionCounter;
  }

  private bundledDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'seed-knowledge-base');
  }

  private userDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'knowledge-base');
  }

  private workspaceDir(): vscode.Uri | undefined {
    const root = vscode.workspace.workspaceFolders?.[0];
    return root ? vscode.Uri.joinPath(root.uri, WORKSPACE_DIR) : undefined;
  }

  private dirForTier(tier: KnowledgeBaseTier): vscode.Uri | undefined {
    if (tier === 'bundled') return this.bundledDir();
    if (tier === 'user') return this.userDir();
    return this.workspaceDir();
  }

  /** Re-reads every tier from disk. Cheap (a handful of small JSON files)
   *  and only called on explicit refresh / after a mutation, not per
   *  request. */
  async refresh(): Promise<void> {
    const next = new Map<string, KnowledgeBase>();
    for (const tier of ['bundled', 'workspace', 'user'] as KnowledgeBaseTier[]) {
      for (const kb of await this.readTier(tier)) {
        next.set(kb.id, kb);
      }
    }
    this.cache = next;
    this.revisionCounter += 1;
  }

  private async readTier(tier: KnowledgeBaseTier): Promise<KnowledgeBase[]> {
    const dir = this.dirForTier(tier);
    if (!dir) return [];

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return []; // Tier directory doesn't exist yet -- normal, not an error.
    }

    const results: KnowledgeBase[] = [];
    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.toLowerCase().endsWith('.json')) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Partial<KnowledgeBase>;
        const slug = name.replace(/\.json$/i, '');
        results.push({
          id: `${tier}:${slug}`,
          tier,
          name: parsed.name || slug,
          description: parsed.description || '',
          documents: Array.isArray(parsed.documents) ? parsed.documents : [],
        });
      } catch {
        // A single malformed/unreadable KB file must not take down the
        // whole list -- skip it and keep going.
      }
    }
    return results;
  }

  /** Filename (without tier prefix) a KB id maps to on disk. */
  private slugOf(id: string): string {
    const colon = id.indexOf(':');
    return colon >= 0 ? id.slice(colon + 1) : id;
  }

  private async writeKb(kb: KnowledgeBase): Promise<void> {
    if (kb.tier === 'bundled') {
      throw new Error('Built-in knowledge bases are read-only. Create a workspace or personal one to add documents.');
    }
    const dir = this.dirForTier(kb.tier);
    if (!dir) {
      throw new Error('Open a workspace folder before creating a workspace knowledge base.');
    }
    await vscode.workspace.fs.createDirectory(dir);
    const body = {
      name: kb.name,
      description: kb.description,
      documents: kb.documents,
    };
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, `${this.slugOf(kb.id)}.json`),
      Buffer.from(JSON.stringify(body, null, 2), 'utf-8')
    );
    this.cache.set(kb.id, kb);
    this.revisionCounter += 1;
  }

  getAll(): KnowledgeBase[] {
    return Array.from(this.cache.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): KnowledgeBase | undefined {
    return this.cache.get(id);
  }

  /** Webview-facing view: never includes document text, only titles and
   *  sizes -- the full corpus stays host-side, same posture as attached
   *  files and Jira chunks. */
  listMeta(): KnowledgeBaseMeta[] {
    return this.getAll().map((kb) => ({
      id: kb.id,
      tier: kb.tier,
      name: kb.name,
      description: kb.description,
      readOnly: kb.tier === 'bundled',
      documents: kb.documents.map((d) => ({ id: d.id, title: d.title, charCount: d.text.length })),
      totalChars: kb.documents.reduce((sum, d) => sum + d.text.length, 0),
    }));
  }

  async create(tier: 'workspace' | 'user', name: string, description: string): Promise<KnowledgeBase> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a name for the knowledge base.');

    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) throw new Error(`"${name}" doesn't contain any usable characters for a file name.`);

    const id = `${tier}:${slug}`;
    if (this.cache.has(id)) {
      throw new Error(`A ${tier} knowledge base named "${trimmed}" already exists.`);
    }

    const kb: KnowledgeBase = { id, tier, name: trimmed, description: description.trim(), documents: [] };
    await this.writeKb(kb);
    return kb;
  }

  async delete(id: string): Promise<void> {
    const kb = this.cache.get(id);
    if (!kb) throw new Error('That knowledge base no longer exists.');
    if (kb.tier === 'bundled') throw new Error('Built-in knowledge bases cannot be deleted.');

    const dir = this.dirForTier(kb.tier);
    if (dir) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, `${this.slugOf(id)}.json`));
      } catch {
        // Already gone on disk -- fall through and drop it from the cache.
      }
    }
    this.cache.delete(id);
    this.revisionCounter += 1;
  }

  async addDocument(id: string, title: string, text: string, sourcePath?: string): Promise<KbDocument> {
    const kb = this.cache.get(id);
    if (!kb) throw new Error('That knowledge base no longer exists.');
    if (!text.trim()) throw new Error(`"${title}" produced no readable text, so there is nothing to index.`);

    const doc: KbDocument = {
      id: `doc-${crypto.randomUUID()}`,
      title,
      text,
      sourcePath,
      addedAt: new Date().toISOString(),
    };
    kb.documents.push(doc);
    await this.writeKb(kb);
    return doc;
  }

  async removeDocument(id: string, documentId: string): Promise<void> {
    const kb = this.cache.get(id);
    if (!kb) throw new Error('That knowledge base no longer exists.');
    kb.documents = kb.documents.filter((d) => d.id !== documentId);
    await this.writeKb(kb);
  }
}
