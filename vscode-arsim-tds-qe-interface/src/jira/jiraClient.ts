import * as https from 'https';

/**
 * Second real outbound HTTP client in this extension, same shape as
 * src/serviceNow/serviceNowClient.ts (Node's built-in https, Basic Auth,
 * a typed error class) -- no new dependency, no fetch polyfill.
 */

export interface JiraCredentials {
  username: string;
  password: string;
}

export type JiraErrorKind = 'network' | 'timeout' | 'auth' | 'http' | 'parse' | 'validation';

export class JiraApiError extends Error {
  constructor(message: string, public readonly kind: JiraErrorKind) {
    super(message);
    this.name = 'JiraApiError';
  }
}

/** Raw shape of a Jira REST v2 `issue` resource, narrowed to the fields
 *  this workflow reads. `renderedFields` (via `?expand=renderedFields`)
 *  gives HTML with real `<table>` markup for wiki-markup tables; `fields`
 *  is the plain-text/wiki-markup fallback when rendering isn't available
 *  (e.g. an instance that doesn't support the expand param).
 *
 *  The Acceptance Criteria custom field is NOT the same id on both sites
 *  (jtmf.td.com uses customfield_10200, track.td.com uses
 *  customfield_14400) -- so it can't be a fixed property here. Both
 *  `fields`/`renderedFields` carry an index signature instead, and the
 *  caller looks the right key up via ACCEPTANCE_CRITERIA_FIELD_BY_SITE. */
export interface JiraIssueRaw {
  key: string;
  fields: {
    summary: string;
    description: string | null;
    attachment?: JiraAttachmentRaw[];
    [customFieldKey: string]: unknown;
  };
  renderedFields?: {
    description?: string | null;
    [customFieldKey: string]: unknown;
  };
}

export interface JiraAttachmentRaw {
  id: string;
  filename: string;
  created: string; // ISO timestamp
  size: number;
  mimeType: string;
  content: string; // download URL, same host, requires the same Basic Auth
}

export const JIRA_SITE_BASE_URLS: Record<'jtmf' | 'track', string> = {
  jtmf: 'https://jtmf.td.com',
  track: 'https://track.td.com',
};

/** The Acceptance Criteria custom field id is per-instance, not universal
 *  -- jtmf.td.com and track.td.com are separate Jira instances with
 *  different custom-field numbering. */
export const ACCEPTANCE_CRITERIA_FIELD_BY_SITE: Record<'jtmf' | 'track', string> = {
  jtmf: 'customfield_10200',
  track: 'customfield_14400',
};

/** Ticket keys look like PROJ-123. Accepts either a bare key or a full
 *  browse/API URL and pulls the key out of either. */
export function extractJiraKey(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/([A-Z][A-Z0-9]*-\d+)/);
  if (!match) {
    throw new JiraApiError(
      `Could not find a Jira ticket key (e.g. PROJ-123) in "${trimmed}".`,
      'validation'
    );
  }
  return match[1];
}

function authHeader(creds: JiraCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
}

function get(url: URL, creds: JiraCredentials, timeoutMs: number, accept: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers: { Authorization: authHeader(creds), Accept: accept }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new JiraApiError(`Jira rejected the credentials (HTTP ${res.statusCode}).`, 'auth'));
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new JiraApiError(
                `Jira returned HTTP ${res.statusCode ?? '(no status)'}: ${body.toString('utf-8').slice(0, 300)}`,
                'http'
              )
            );
            return;
          }
          resolve(body);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new JiraApiError(`Jira request timed out after ${timeoutMs}ms.`, 'timeout'));
    });
    req.on('error', (err) => reject(new JiraApiError(`Network error contacting Jira: ${err.message}`, 'network')));
    req.end();
  });
}

export async function fetchJiraIssue(
  key: string,
  baseUrl: string,
  creds: JiraCredentials,
  timeoutMs: number
): Promise<JiraIssueRaw> {
  let url: URL;
  try {
    url = new URL(`/rest/api/2/issue/${encodeURIComponent(key)}`, baseUrl);
  } catch {
    throw new JiraApiError(`Invalid Jira base URL: "${baseUrl}".`, 'validation');
  }
  url.searchParams.set('expand', 'renderedFields');

  const body = await get(url, creds, timeoutMs, 'application/json');
  try {
    return JSON.parse(body.toString('utf-8')) as JiraIssueRaw;
  } catch {
    throw new JiraApiError('Could not parse the Jira response as JSON.', 'parse');
  }
}

const JIRA_HOST_URL_PATTERN = /(https?:\/\/(?:jtmf|track)\.td\.com\/[^\s"'<>]+)/gi;

/**
 * Scans free text (AC/description) for URLs pointing at either known Jira
 * host and pulls out any ticket keys found, excluding the ticket's own
 * key. Used for the single-level "linked ticket" expansion -- a linked
 * ticket's own text is not itself scanned again, so this never recurses.
 */
/**
 * Like findLinkedTicketKeys below, but reports WHICH host each ticket
 * lives on. The Confluence importer needs that: a page can link tickets
 * on both jtmf and track, and each site has its own base URL *and* its
 * own Acceptance Criteria custom-field id
 * (ACCEPTANCE_CRITERIA_FIELD_BY_SITE), so "the key" alone isn't enough to
 * fetch it correctly. Deduplicated on site+key.
 */
export function findJiraLinks(text: string): { site: 'jtmf' | 'track'; key: string }[] {
  const seen = new Set<string>();
  const out: { site: 'jtmf' | 'track'; key: string }[] = [];
  const urls = text.match(JIRA_HOST_URL_PATTERN) || [];
  for (const url of urls) {
    const site: 'jtmf' | 'track' = /jtmf\.td\.com/i.test(url) ? 'jtmf' : 'track';
    try {
      const key = extractJiraKey(url);
      const dedupeKey = `${site}:${key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ site, key });
    } catch {
      // Not a ticket link (e.g. a Confluence/dashboard URL on the same
      // host) -- skip rather than failing the whole scan.
    }
  }
  return out;
}

export function findLinkedTicketKeys(text: string, excludeKey: string): string[] {
  const found = new Set<string>();
  const urls = text.match(JIRA_HOST_URL_PATTERN) || [];
  for (const url of urls) {
    try {
      const key = extractJiraKey(url);
      if (key !== excludeKey) found.add(key);
    } catch {
      // The URL didn't contain a recognizable ticket key -- not a ticket
      // link (e.g. a link to a Confluence page on the same host), skip it.
    }
  }
  return Array.from(found);
}

/** Downloads an attachment's raw bytes from its `content` URL (same host,
 *  same Basic Auth) -- handed off to the existing csv/xlsx/docx parsers in
 *  src/fileIngest/, exactly like a Browse-picked file's buffer would be. */
export async function fetchJiraAttachment(
  contentUrl: string,
  creds: JiraCredentials,
  timeoutMs: number
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(contentUrl);
  } catch {
    throw new JiraApiError(`Invalid attachment URL: "${contentUrl}".`, 'validation');
  }
  return get(url, creds, timeoutMs, '*/*');
}
