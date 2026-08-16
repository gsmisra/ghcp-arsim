import { flattenHtml } from '../common/htmlFlatten';
import { findJiraLinks } from '../jira/jiraClient';
import { ConfluenceAttachmentRef } from './confluenceClient';

/**
 * Everything this module needs from the outside world (HTTP, file
 * parsing, Jira) arrives as an injected "ports" object rather than being
 * called directly -- the BFS/dedup/cap/dedup-by-version logic below is the
 * part most likely to have an off-by-one, so it needs to be exercised with
 * a fake, in-memory fetcher in a unit test, with zero network and zero
 * vscode dependency. The real ports (confluenceClient.ts + fileIngest +
 * jiraClient.ts) are wired up by MainViewProvider.
 */
export interface ConfluenceImportPorts {
  fetchPage(pageId: string): Promise<{ id: string; title: string; bodyStorageHtml: string; webuiUrl: string }>;
  fetchChildPages(pageId: string): Promise<{ id: string; title: string }[]>;
  fetchAttachments(pageId: string): Promise<ConfluenceAttachmentRef[]>;
  downloadAttachment(downloadUrl: string): Promise<Buffer>;
  /** Returns null to mean "skip this attachment" (e.g. an unsupported or
   *  unparseable format) without failing the whole import. */
  parseAttachmentText(buffer: Buffer, fileName: string): Promise<string | null>;
  /** Returns null when the ticket couldn't be fetched (deleted, no
   *  permission, wrong key) -- treated as supplementary, not fatal. */
  fetchJiraTicketText(site: 'jtmf' | 'track', key: string): Promise<{ title: string; text: string } | null>;
  onProgress?(info: { message: string; pagesDone: number; pagesTotal: number | null }): void;
  isCancelled?(): boolean;
}

export type ConfluenceImportItemKind = 'page' | 'attachment' | 'jira';

export interface ConfluenceImportItem {
  kind: ConfluenceImportItemKind;
  /** Becomes the Knowledge Base document title. */
  title: string;
  text: string;
  /** Page URL, attachment filename, or "SITE-123" -- shown to the user and
   *  stored as the KB document's sourcePath. */
  sourceRef: string;
}

export interface ConfluenceImportResult {
  items: ConfluenceImportItem[];
  pagesFetched: number;
  attachmentsFetched: number;
  attachmentsSkipped: number;
  jiraTicketsFetched: number;
  /** True when the page cap or a cancellation stopped traversal before
   *  every reachable page/child was visited -- the caller must surface
   *  this rather than silently returning a partial import as if complete. */
  stoppedEarly: boolean;
  cancelled: boolean;
}

const SUPPORTED_ATTACHMENT_EXT = /\.(csv|docx|pdf|xlsx|json|xml)$/i;

interface QueueEntry {
  pageId: string;
  depth: number;
}

/**
 * Breadth-first import of a Confluence page and its sub-tree, up to
 * `maxDepth` levels (root = depth 0) and `maxPages` total pages, plus the
 * latest version of every supported attachment on every visited page, plus
 * every jtmf.td.com/track.td.com Jira ticket linked from any visited
 * page's text (fetched once each, not recursively re-scanned for further
 * links -- one hop only).
 */
export async function importConfluenceTree(
  rootPageId: string,
  maxDepth: number,
  maxPages: number,
  ports: ConfluenceImportPorts
): Promise<ConfluenceImportResult> {
  const items: ConfluenceImportItem[] = [];
  const visited = new Set<string>();
  const queue: QueueEntry[] = [{ pageId: rootPageId, depth: 0 }];
  const jiraLinks = new Map<string, { site: 'jtmf' | 'track'; key: string }>();
  // { title -> attachment ref } across the whole import, so the same
  // filename attached at two levels of the tree is only imported once, at
  // its highest known version -- mirrors the existing Jira
  // latest-upload-per-filename rule.
  const attachmentsByTitle = new Map<string, { ref: ConfluenceAttachmentRef; pageId: string }>();

  let pagesFetched = 0;
  let stoppedEarly = false;
  let cancelled = false;

  while (queue.length > 0) {
    if (ports.isCancelled?.()) {
      cancelled = true;
      stoppedEarly = true;
      break;
    }
    if (visited.size >= maxPages) {
      stoppedEarly = queue.length > 0;
      break;
    }

    const entry = queue.shift()!;
    if (visited.has(entry.pageId)) continue; // diamond: reached via two paths, fetch once
    visited.add(entry.pageId);

    const page = await ports.fetchPage(entry.pageId);
    pagesFetched += 1;
    ports.onProgress?.({
      message: `Fetched page "${page.title}" (${pagesFetched}/${maxPages})`,
      pagesDone: pagesFetched,
      pagesTotal: null,
    });

    const flattened = flattenHtml(page.bodyStorageHtml);
    items.push({ kind: 'page', title: page.title, text: flattened, sourceRef: page.webuiUrl || page.id });

    for (const link of findJiraLinks(flattened)) {
      jiraLinks.set(`${link.site}:${link.key}`, link);
    }

    const attachments = await ports.fetchAttachments(entry.pageId);
    for (const att of attachments) {
      if (!SUPPORTED_ATTACHMENT_EXT.test(att.title)) continue;
      const existing = attachmentsByTitle.get(att.title);
      if (!existing || att.version > existing.ref.version) {
        attachmentsByTitle.set(att.title, { ref: att, pageId: entry.pageId });
      }
    }

    if (entry.depth < maxDepth) {
      const children = await ports.fetchChildPages(entry.pageId);
      for (const child of children) {
        if (!visited.has(child.id)) {
          queue.push({ pageId: child.id, depth: entry.depth + 1 });
        }
      }
    }
  }

  let attachmentsFetched = 0;
  let attachmentsSkipped = 0;
  for (const { ref } of attachmentsByTitle.values()) {
    if (ports.isCancelled?.()) {
      cancelled = true;
      stoppedEarly = true;
      break;
    }
    try {
      const buffer = await ports.downloadAttachment(ref.downloadUrl);
      const text = await ports.parseAttachmentText(buffer, ref.title);
      if (text === null || text.trim().length === 0) {
        attachmentsSkipped += 1;
        continue;
      }
      items.push({ kind: 'attachment', title: ref.title, text, sourceRef: ref.title });
      attachmentsFetched += 1;
      ports.onProgress?.({
        message: `Imported attachment "${ref.title}"`,
        pagesDone: pagesFetched,
        pagesTotal: null,
      });
    } catch {
      // A single unreadable attachment (corrupt file, transient network
      // blip) is not fatal to the rest of the import -- skip and continue.
      attachmentsSkipped += 1;
    }
  }

  let jiraTicketsFetched = 0;
  for (const link of jiraLinks.values()) {
    if (ports.isCancelled?.()) {
      cancelled = true;
      stoppedEarly = true;
      break;
    }
    const ticket = await ports.fetchJiraTicketText(link.site, link.key);
    if (ticket) {
      items.push({ kind: 'jira', title: `${link.key}: ${ticket.title}`, text: ticket.text, sourceRef: `${link.site}:${link.key}` });
      jiraTicketsFetched += 1;
      ports.onProgress?.({
        message: `Imported linked Jira ticket ${link.key}`,
        pagesDone: pagesFetched,
        pagesTotal: null,
      });
    }
  }

  return {
    items,
    pagesFetched,
    attachmentsFetched,
    attachmentsSkipped,
    jiraTicketsFetched,
    stoppedEarly,
    cancelled,
  };
}
