export interface TextChunk {
  /** 0-based position of this chunk within its source document. */
  index: number;
  text: string;
}

export interface ChunkOptions {
  targetChars: number;
  overlapChars: number;
}

export const DEFAULT_CHUNK_CHARS = 1200;
export const DEFAULT_CHUNK_OVERLAP_CHARS = 200;

/**
 * Splits a document into overlapping, retrieval-sized chunks.
 *
 * Two design points that matter for retrieval quality:
 *
 * 1. SPLIT ON PARAGRAPH BOUNDARIES, not a fixed character stride. BM25
 *    scores whole chunks, so a chunk that starts mid-sentence carries
 *    fragmentary context the model then has to reason around. Paragraphs
 *    are the natural semantic unit in the runbooks/specs/standards docs
 *    this indexes.
 * 2. OVERLAP between adjacent chunks. Without it, a fact that straddles a
 *    chunk boundary ("the cutover time is\n\n17:00 EST") lands half in
 *    each chunk and may score too low in both to be retrieved at all.
 *    Carrying the tail of the previous chunk forward makes boundary-
 *    spanning facts findable from either side.
 *
 * A single paragraph longer than targetChars is emitted as its own chunk
 * rather than being hard-split mid-word -- oversized chunks are handled
 * downstream by the context budget, whereas a word split in half is
 * unrecoverable (it breaks tokenization, so it stops matching queries).
 */
export function chunkText(text: string, options?: Partial<ChunkOptions>): TextChunk[] {
  const targetChars = options?.targetChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = options?.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS;

  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= targetChars) return [{ index: 0, text: trimmed }];

  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: TextChunk[] = [];
  let current = '';

  const flush = () => {
    const body = current.trim();
    if (!body) return;
    chunks.push({ index: chunks.length, text: body });
    // Carry the tail forward as the next chunk's lead-in, backing off to
    // a word boundary so the overlap never begins mid-word.
    if (overlapChars > 0 && body.length > overlapChars) {
      const tail = body.slice(-overlapChars);
      const firstSpace = tail.indexOf(' ');
      current = firstSpace >= 0 ? tail.slice(firstSpace + 1) : '';
    } else {
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    // Adding this paragraph would overflow the target -- close the
    // current chunk first (unless it holds nothing but carried overlap,
    // in which case closing it would emit a chunk of pure duplicate text).
    if (current && current.length + paragraph.length + 2 > targetChars) {
      flush();
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;

    // A single paragraph bigger than the target: emit it alone rather
    // than splitting mid-word (see the doc comment above).
    if (current.length >= targetChars) {
      flush();
    }
  }

  flush();
  return chunks;
}
