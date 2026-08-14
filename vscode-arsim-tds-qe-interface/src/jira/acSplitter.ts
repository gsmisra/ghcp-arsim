export interface TextSegment {
  label: string;
  content: string;
}

/**
 * Best-effort split of a free-text Acceptance Criteria field into labeled
 * segments (AC1, AC2, ...). There is no schema to rely on -- Jira custom
 * fields are arbitrary text, and how a team formats multiple criteria
 * varies org to org -- so this looks for lines that read as a segment
 * header ("AC1", "AC 2:", "Acceptance Criteria 3", etc.) and splits there.
 * When no such markers are found, the whole field is treated as one
 * segment rather than guessing at a split that isn't really there.
 */
const SEGMENT_HEADER = /^\s*(AC\s*-?\s*\d+|Acceptance\s+Criteria\s*\d*)\s*[:.\-]?\s*$/i;

export function splitAcceptanceCriteria(text: string): TextSegment[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  const lines = trimmed.split('\n');
  const boundaries: { index: number; label: string }[] = [];
  lines.forEach((line, i) => {
    const m = line.match(SEGMENT_HEADER);
    if (m) boundaries.push({ index: i, label: m[1].replace(/\s+/g, ' ').trim().toUpperCase() });
  });

  if (boundaries.length === 0) {
    return [{ label: 'Acceptance Criteria', content: trimmed }];
  }

  const segments: TextSegment[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].index + 1; // body starts after the header line
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : lines.length;
    const body = lines.slice(start, end).join('\n').trim();
    if (body) segments.push({ label: boundaries[i].label, content: body });
  }

  // Every boundary line's body was empty (e.g. headers with no content
  // between them, or a false-positive match) -- fall back to the whole
  // field as one segment rather than returning nothing.
  return segments.length > 0 ? segments : [{ label: 'Acceptance Criteria', content: trimmed }];
}
