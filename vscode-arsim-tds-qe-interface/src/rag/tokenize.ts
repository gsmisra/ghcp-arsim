/**
 * The single tokenizer used for BOTH indexing and querying.
 *
 * That "both" is the whole point of it living in its own module: BM25
 * matches on exact token equality, so if the index and the query ever
 * tokenized differently -- even subtly, like one stripping a trailing "s"
 * and the other not -- terms would silently fail to match and retrieval
 * would quietly return nothing useful. One function, one source of truth.
 *
 * Deliberately dependency-free (no natural/stemmer packages): this keeps
 * the esbuild-only, zero-native-deps posture the rest of the extension
 * has, and a full stemmer is the wrong trade here anyway (see below).
 */

/**
 * Standard English stopwords plus a few that are pure noise in this
 * domain's corpora (documentation/runbooks/specs) and would otherwise
 * appear in nearly every document -- terms in almost every document carry
 * near-zero IDF anyway, so dropping them mainly saves index size and
 * scoring work rather than changing rankings much.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'cannot', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'may', 'me', 'might', 'must', 'my', 'no', 'nor',
  'not', 'of', 'on', 'or', 'our', 'shall', 'she', 'should', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
  'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
]);

/**
 * Conservative suffix normalization -- NOT a full Porter stemmer.
 *
 * Porter is aggressive enough to actively hurt a domain corpus like this
 * one: it collapses "posting"/"posted"/"post" into one term, but in
 * banking those are genuinely different concepts (a posting, a posted
 * transaction, to post). It also mangles acronym-ish tokens. So this only
 * handles the two cases that are almost always safe -- regular plurals
 * and a narrow set of verb endings -- and leaves everything else alone.
 *
 * Guarded by a minimum resulting length so short tokens aren't destroyed
 * (e.g. "ses" must not become "s").
 */
function normalizeSuffix(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) {
    return token.slice(0, -3) + 'y'; // policies -> policy
  }
  if (token.length > 4 && (token.endsWith('sses') || token.endsWith('shes') || token.endsWith('ches'))) {
    return token.slice(0, -2); // addresses -> address, batches -> batch
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us') && !token.endsWith('is')) {
    return token.slice(0, -1); // accounts -> account (but not: status, analysis, access)
  }
  return token;
}

/**
 * Splits text into normalized terms. Numbers are kept (amounts, error
 * codes, and ticket numbers are meaningful query terms in this domain),
 * as are alphanumeric tokens like "sev1" or "iso20022" -- splitting those
 * apart would lose exactly the specificity that makes them good search
 * terms.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const raw = text.toLowerCase().split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2) continue; // single chars carry no retrieval signal
    if (STOPWORDS.has(token)) continue;
    out.push(normalizeSuffix(token));
  }
  return out;
}

/** Term -> frequency map for one document (the sparse "vector"). */
export function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}
