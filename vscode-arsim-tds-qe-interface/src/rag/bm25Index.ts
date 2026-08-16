import { tokenize, termFrequencies } from './tokenize';

/**
 * In-memory BM25 retrieval index: a flat array of {id, vector, metadata}
 * documents scored by a brute-force linear scan.
 *
 * WHY BM25 SCORING RATHER THAN COSINE SIMILARITY
 * ----------------------------------------------
 * The store's *shape* is the classic vector-space one (sparse term
 * vectors, linear scan), but the scoring function is BM25 (Robertson /
 * Sparck Jones), not cosine over TF-IDF. Those are genuinely different
 * models, and BM25 is the stronger lexical ranker for two concrete
 * reasons cosine lacks:
 *
 *   1. Term-frequency saturation (k1): a document containing a query term
 *      20 times is more relevant than one containing it twice, but not
 *      10x more. Raw/normalized TF in cosine scales roughly linearly and
 *      lets one keyword-stuffed chunk dominate the results.
 *   2. Document-length normalization (b): a term appearing in a 100-word
 *      chunk means more than the same term in a 2000-word chunk. Cosine
 *      normalizes by vector magnitude, which is a blunter proxy and tends
 *      to over-reward very short documents.
 *
 * Swapping to strict cosine-over-TF-IDF is a single-function change
 * (replace scoreDocument() below); nothing else in the pipeline depends
 * on which scorer is used.
 *
 * Complexity: build is O(total tokens); search is O(documents x query
 * terms) with an early skip for documents sharing no query term. At
 * knowledge-base scale (thousands of chunks) this is sub-millisecond,
 * which is what makes it safe to run on the debounced live
 * context-estimate path as well as on send.
 */

/** Standard BM25 defaults; both are overridable from settings. */
export const DEFAULT_K1 = 1.5;
export const DEFAULT_B = 0.75;

export interface IndexedDocument<M> {
  id: string;
  /** Sparse term -> raw term-frequency map. */
  vector: Map<string, number>;
  /** Total token count, for BM25's length normalization. */
  length: number;
  metadata: M;
}

export interface SearchHit<M> {
  id: string;
  score: number;
  metadata: M;
}

export class Bm25Index<M> {
  private documents: IndexedDocument<M>[] = [];
  /** term -> number of documents containing it. */
  private documentFrequency = new Map<string, number>();
  private averageLength = 0;
  private built = false;

  constructor(private readonly k1: number = DEFAULT_K1, private readonly b: number = DEFAULT_B) {}

  get size(): number {
    return this.documents.length;
  }

  add(id: string, text: string, metadata: M): void {
    const tokens = tokenize(text);
    this.documents.push({ id, vector: termFrequencies(tokens), length: tokens.length, metadata });
    this.built = false;
  }

  /** Computes document frequencies + average document length. Called
   *  automatically by search() when needed, so callers can just add()
   *  everything and search. */
  build(): void {
    this.documentFrequency = new Map();
    let totalLength = 0;

    for (const doc of this.documents) {
      totalLength += doc.length;
      // Each *distinct* term in a document contributes 1 to its df --
      // iterating the tf map's keys (not the token list) is what makes
      // that correct.
      for (const term of doc.vector.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }

    this.averageLength = this.documents.length > 0 ? totalLength / this.documents.length : 0;
    this.built = true;
  }

  /**
   * Smoothed (Lucene-style) IDF: ln(1 + (N - df + 0.5) / (df + 0.5)).
   *
   * The `1 +` inside the log is load-bearing, not cosmetic. Textbook BM25
   * IDF -- ln((N - df + 0.5) / (df + 0.5)) -- goes NEGATIVE once a term
   * appears in more than about half the corpus, which means a document
   * matching a common query term scores *worse* than one that doesn't
   * match it at all. That's a real, easy-to-ship ranking bug. This
   * variant is monotonically decreasing in df and always > 0.
   */
  private inverseDocumentFrequency(term: string): number {
    const n = this.documents.length;
    const df = this.documentFrequency.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private scoreDocument(doc: IndexedDocument<M>, queryTerms: string[]): number {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = doc.vector.get(term);
      if (!frequency) continue; // term absent from this document -- contributes nothing

      const idf = this.inverseDocumentFrequency(term);
      const lengthNorm =
        this.averageLength > 0 ? 1 - this.b + this.b * (doc.length / this.averageLength) : 1;
      score += idf * ((frequency * (this.k1 + 1)) / (frequency + this.k1 * lengthNorm));
    }
    return score;
  }

  /** Top-K highest scoring documents. Documents scoring 0 (no query term
   *  present) are never returned -- padding results with irrelevant
   *  chunks would waste context budget for no benefit. */
  search(query: string, topK: number): SearchHit<M>[] {
    if (this.documents.length === 0) return [];
    if (!this.built) this.build();

    // De-duplicated query terms: a term repeated in the query shouldn't
    // multiply its own contribution to the score.
    const queryTerms = Array.from(new Set(tokenize(query)));
    if (queryTerms.length === 0) return [];

    const hits: SearchHit<M>[] = [];
    for (const doc of this.documents) {
      const score = this.scoreDocument(doc, queryTerms);
      if (score > 0) {
        hits.push({ id: doc.id, score, metadata: doc.metadata });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, Math.max(0, topK));
  }
}
