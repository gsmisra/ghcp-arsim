import * as vscode from 'vscode';
import { Bm25Index, DEFAULT_B, DEFAULT_K1 } from './bm25Index';
import { chunkText, DEFAULT_CHUNK_CHARS, DEFAULT_CHUNK_OVERLAP_CHARS } from './chunker';
import { KnowledgeBaseStore } from '../knowledgeBase/knowledgeBaseStore';
import { RetrievedChunk } from '../github/contextBuilder';

/**
 * Ties the knowledge-base store to the BM25 index: chunk every document,
 * index the chunks, and answer top-K queries -- with the built index
 * cached so a KB is only re-chunked and re-indexed when it actually
 * changes.
 *
 * Cache key is `${kbId}@${storeRevision}`: KnowledgeBaseStore bumps its
 * revision on every mutation and refresh, so a stale index can never be
 * served after an edit, and an unchanged KB is never rebuilt. That's what
 * makes it safe to call retrieve() on the 500ms-debounced live
 * context-estimate path as well as on send.
 */

interface ChunkMetadata {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  documentTitle: string;
  text: string;
}

const indexCache = new Map<string, Bm25Index<ChunkMetadata>>();

function ragConfig() {
  const config = vscode.workspace.getConfiguration('arsimTdsQe');
  return {
    topK: config.get<number>('ragTopK', 6),
    chunkChars: config.get<number>('ragChunkChars', DEFAULT_CHUNK_CHARS),
    overlapChars: config.get<number>('ragChunkOverlapChars', DEFAULT_CHUNK_OVERLAP_CHARS),
    k1: config.get<number>('bm25K1', DEFAULT_K1),
    b: config.get<number>('bm25B', DEFAULT_B),
  };
}

/** Drops every cached index. Called when settings that affect indexing
 *  (chunk size/overlap, k1/b) change -- those invalidate the built index
 *  itself, not just its contents. */
export function clearRetrievalCache(): void {
  indexCache.clear();
}

function indexFor(store: KnowledgeBaseStore, knowledgeBaseId: string): Bm25Index<ChunkMetadata> | undefined {
  const kb = store.get(knowledgeBaseId);
  if (!kb) return undefined;

  const cacheKey = `${knowledgeBaseId}@${store.revision}`;
  const cached = indexCache.get(cacheKey);
  if (cached) return cached;

  const { chunkChars, overlapChars, k1, b } = ragConfig();
  const index = new Bm25Index<ChunkMetadata>(k1, b);

  for (const doc of kb.documents) {
    for (const chunk of chunkText(doc.text, { targetChars: chunkChars, overlapChars })) {
      index.add(`${doc.id}#${chunk.index}`, chunk.text, {
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        documentTitle: doc.title,
        text: chunk.text,
      });
    }
  }
  index.build();

  // Only this KB's previous-revision entries are stale; clearing the
  // whole map on every rebuild would needlessly discard other KBs'
  // indexes, so drop just the ones for this id.
  for (const key of indexCache.keys()) {
    if (key.startsWith(`${knowledgeBaseId}@`)) indexCache.delete(key);
  }
  indexCache.set(cacheKey, index);
  return index;
}

/**
 * Builds (or confirms cached) indexes for the given knowledge bases
 * without running a query -- fire-and-forget from the moment a KB is
 * *selected*, rather than paying that cost on the user's first real
 * question. `retrieve()` below already short-circuits on an empty query
 * (e.g. the estimateContext call that fires the instant a KB checkbox is
 * ticked, before any text is typed), which used to mean the index for a
 * newly-selected KB wasn't actually built until the first real send --
 * bundling the one-time chunk/tokenize/index cost invisibly into what
 * should be a fast request. Calling this eagerly on selection moves that
 * cost earlier, off the user-visible request path, for every KB size --
 * including a large Confluence-imported one.
 */
export function warmIndexes(store: KnowledgeBaseStore, knowledgeBaseIds: string[] | null | undefined): void {
  if (!knowledgeBaseIds) return;
  for (const id of knowledgeBaseIds) {
    indexFor(store, id);
  }
}

/**
 * Retrieves the top-K chunks across all selected knowledge bases for
 * `query`. Each KB is searched independently, then results are merged and
 * re-ranked globally by BM25 score -- so one highly-relevant KB can
 * legitimately supply all K chunks rather than every KB being forced to
 * contribute equally.
 *
 * Returns [] (doing no work at all) when nothing is selected or the query
 * has no searchable terms, which is what keeps this free for every user
 * who never touches the feature.
 */
export function retrieve(
  store: KnowledgeBaseStore,
  knowledgeBaseIds: string[],
  query: string,
  topKOverride?: number
): RetrievedChunk[] {
  if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return [];
  if (!query || !query.trim()) return [];

  const topK = topKOverride ?? ragConfig().topK;
  if (topK <= 0) return [];

  const merged: { score: number; metadata: ChunkMetadata }[] = [];
  for (const id of knowledgeBaseIds) {
    const index = indexFor(store, id);
    if (!index) continue;
    for (const hit of index.search(query, topK)) {
      merged.push({ score: hit.score, metadata: hit.metadata });
    }
  }

  merged.sort((a, b) => b.score - a.score);

  return merged.slice(0, topK).map((hit) => ({
    label: `${hit.metadata.knowledgeBaseName} / ${hit.metadata.documentTitle}`,
    content: hit.metadata.text,
    info: {
      knowledgeBaseName: hit.metadata.knowledgeBaseName,
      documentTitle: hit.metadata.documentTitle,
      score: Math.round(hit.score * 1000) / 1000,
      charCount: hit.metadata.text.length,
    },
  }));
}
