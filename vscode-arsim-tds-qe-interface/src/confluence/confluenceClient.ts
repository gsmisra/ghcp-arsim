import * as https from 'https';

/**
 * Third real outbound HTTP client in this extension, same shape as
 * src/serviceNow/serviceNowClient.ts and src/jira/jiraClient.ts (Node's
 * built-in https, Basic Auth, a typed error class) -- no new dependency.
 */

export interface ConfluenceCredentials {
  username: string;
  password: string;
}

export type ConfluenceErrorKind = 'network' | 'timeout' | 'auth' | 'http' | 'parse' | 'validation';

export class ConfluenceApiError extends Error {
  constructor(message: string, public readonly kind: ConfluenceErrorKind) {
    super(message);
    this.name = 'ConfluenceApiError';
  }
}

export interface ConfluenceSpaceRef {
  key: string;
  name?: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  space: ConfluenceSpaceRef;
  /** Flattenable XHTML body (`?expand=body.storage`). */
  bodyStorageHtml: string;
  version: number;
  webuiUrl: string;
}

export interface ConfluenceAttachmentRef {
  id: string;
  title: string;
  version: number;
  mediaType: string;
  /** Relative or absolute download link; resolved against the site origin. */
  downloadUrl: string;
}

/** Parsed identity of a pasted Confluence link: enough to build every REST
 *  call against the *same* site without asking the user for a separate
 *  "base URL" setting -- the origin, API base path (Cloud vs Server/DC),
 *  and (if the URL already carried it) the numeric page id all come out of
 *  the link itself. */
export interface ParsedConfluenceUrl {
  origin: string;
  /** e.g. 'https://team.atlassian.net/wiki/rest/api' or
   *  'https://confluence.internal.example.com/rest/api'. */
  apiBase: string;
  isCloud: boolean;
  /** Present when the URL shape already encodes the page id
   *  (viewpage.action?pageId=N, or Cloud's /pages/N/Title). Absent for
   *  title-based /display/SPACE/Title links, which need resolvePageId(). */
  pageId?: string;
  spaceKey?: string;
  title?: string;
}

/**
 * Handles the three URL shapes Confluence actually produces in the wild:
 *   - Server/DC "display" links:   {origin}[/ctx]/display/SPACE/Page+Title
 *   - Server/DC legacy links:      {origin}[/ctx]/pages/viewpage.action?pageId=12345
 *   - Cloud links:                 {origin}/wiki/spaces/SPACE/pages/12345/Page+Title
 *
 * Cloud is detected by a `/wiki/` path segment (Atlassian Cloud always
 * serves Confluence under that prefix); Server/DC installs may sit at the
 * root or under an arbitrary context path (e.g. `/confluence`), which is
 * why the context path is derived from the URL itself rather than assumed.
 */
export function parseConfluenceUrl(rawUrl: string): ParsedConfluenceUrl {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ConfluenceApiError(`"${rawUrl}" is not a valid URL.`, 'validation');
  }

  const origin = `${url.protocol}//${url.host}`;
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  const wikiIdx = segments.findIndex((s) => s.toLowerCase() === 'wiki');
  const isCloud = wikiIdx !== -1;

  if (isCloud) {
    // Context path is always exactly "/wiki" on Cloud.
    const apiBase = `${origin}/wiki/rest/api`;
    const rest = segments.slice(wikiIdx + 1); // e.g. ['spaces','SPACE','pages','12345','Title']
    if (rest[0] === 'spaces' && rest[2] === 'pages' && rest[3]) {
      return { origin, apiBase, isCloud, pageId: rest[3], spaceKey: rest[1] };
    }
    if (rest[0] === 'display' && rest[1]) {
      return {
        origin,
        apiBase,
        isCloud,
        spaceKey: rest[1],
        title: decodeTitle(rest.slice(2).join('/')),
      };
    }
    if (rest[0] === 'pages' && rest[1] === 'viewpage.action') {
      const pageId = url.searchParams.get('pageId');
      if (pageId) return { origin, apiBase, isCloud, pageId };
    }
    throw new ConfluenceApiError(
      `Could not recognize the Confluence Cloud URL shape: "${rawUrl}".`,
      'validation'
    );
  }

  // Server/DC: the context path is everything before the first recognized
  // routing segment (display | pages | rest).
  const routeIdx = segments.findIndex((s) => s === 'display' || s === 'pages' || s === 'rest');
  const contextSegments = routeIdx > 0 ? segments.slice(0, routeIdx) : [];
  const contextPath = contextSegments.length ? `/${contextSegments.join('/')}` : '';
  const apiBase = `${origin}${contextPath}/rest/api`;
  const rest = routeIdx >= 0 ? segments.slice(routeIdx) : segments;

  if (rest[0] === 'display' && rest[1]) {
    return { origin, apiBase, isCloud, spaceKey: rest[1], title: decodeTitle(rest.slice(2).join('/')) };
  }
  if (rest[0] === 'pages' && rest[1] === 'viewpage.action') {
    const pageId = url.searchParams.get('pageId');
    if (pageId) return { origin, apiBase, isCloud, pageId };
  }
  throw new ConfluenceApiError(
    `Could not recognize the Confluence URL shape: "${rawUrl}". Expected a ` +
      `/display/SPACE/Title, /pages/viewpage.action?pageId=N, or Cloud ` +
      `/wiki/spaces/SPACE/pages/N/Title link.`,
    'validation'
  );
}

function decodeTitle(pathTitle: string): string {
  try {
    return decodeURIComponent(pathTitle).replace(/\+/g, ' ');
  } catch {
    return pathTitle.replace(/\+/g, ' ');
  }
}

function authHeader(creds: ConfluenceCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
}

function get(url: URL, creds: ConfluenceCredentials, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers: { Authorization: authHeader(creds), Accept: 'application/json' }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new ConfluenceApiError(`Confluence rejected the credentials (HTTP ${res.statusCode}).`, 'auth'));
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new ConfluenceApiError(
                `Confluence returned HTTP ${res.statusCode ?? '(no status)'}: ${body.toString('utf-8').slice(0, 300)}`,
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
      reject(new ConfluenceApiError(`Confluence request timed out after ${timeoutMs}ms.`, 'timeout'));
    });
    req.on('error', (err) =>
      reject(new ConfluenceApiError(`Network error contacting Confluence: ${err.message}`, 'network'))
    );
    req.end();
  });
}

function parseJson<T>(body: Buffer): T {
  try {
    return JSON.parse(body.toString('utf-8')) as T;
  } catch {
    throw new ConfluenceApiError('Could not parse the Confluence response as JSON.', 'parse');
  }
}

/** Resolves a title-based link (/display/SPACE/Title) to a page id. Only
 *  called when the parsed URL didn't already carry one. */
export async function resolvePageId(
  parsed: ParsedConfluenceUrl,
  creds: ConfluenceCredentials,
  timeoutMs: number
): Promise<string> {
  if (parsed.pageId) return parsed.pageId;
  if (!parsed.spaceKey || !parsed.title) {
    throw new ConfluenceApiError('Confluence URL did not resolve to a page id or a space+title.', 'validation');
  }
  const url = new URL(`${parsed.apiBase}/content`);
  url.searchParams.set('spaceKey', parsed.spaceKey);
  url.searchParams.set('title', parsed.title);
  url.searchParams.set('expand', 'version');
  const body = await get(url, creds, timeoutMs);
  const parsedBody = parseJson<{ results: { id: string }[] }>(body);
  if (!parsedBody.results || parsedBody.results.length === 0) {
    throw new ConfluenceApiError(
      `No Confluence page titled "${parsed.title}" found in space "${parsed.spaceKey}".`,
      'http'
    );
  }
  return parsedBody.results[0].id;
}

interface RawContentResponse {
  id: string;
  title: string;
  space?: { key: string; name?: string };
  body?: { storage?: { value: string } };
  version?: { number: number };
  _links?: { webui?: string; base?: string };
}

export async function fetchPage(
  apiBase: string,
  origin: string,
  pageId: string,
  creds: ConfluenceCredentials,
  timeoutMs: number
): Promise<ConfluencePage> {
  const url = new URL(`${apiBase}/content/${encodeURIComponent(pageId)}`);
  url.searchParams.set('expand', 'body.storage,version,space');
  const body = await get(url, creds, timeoutMs);
  const raw = parseJson<RawContentResponse>(body);
  return {
    id: raw.id,
    title: raw.title,
    space: { key: raw.space?.key ?? '', name: raw.space?.name },
    bodyStorageHtml: raw.body?.storage?.value ?? '',
    version: raw.version?.number ?? 1,
    webuiUrl: raw._links?.webui ? `${raw._links.base ?? origin}${raw._links.webui}` : origin,
  };
}

interface RawResultsPage<T> {
  results: T[];
  _links?: { next?: string };
}

/** Generic paginated GET follower for the `/child/page` and
 *  `/child/attachment` endpoints -- both return the same
 *  `{results, _links.next}` envelope, and both can exceed the default page
 *  size on a busy space, so a single page of results is never assumed to
 *  be the whole set. */
async function getAllPages<T>(
  firstUrl: URL,
  origin: string,
  creds: ConfluenceCredentials,
  timeoutMs: number
): Promise<T[]> {
  const out: T[] = [];
  let next: URL | undefined = firstUrl;
  let guard = 0;
  while (next && guard < 200) {
    guard += 1;
    const body: Buffer = await get(next, creds, timeoutMs);
    const page = parseJson<RawResultsPage<T>>(body);
    out.push(...(page.results ?? []));
    next = page._links?.next ? new URL(page._links.next, origin) : undefined;
  }
  return out;
}

export async function fetchChildPages(
  apiBase: string,
  origin: string,
  pageId: string,
  creds: ConfluenceCredentials,
  timeoutMs: number
): Promise<{ id: string; title: string }[]> {
  const url = new URL(`${apiBase}/content/${encodeURIComponent(pageId)}/child/page`);
  url.searchParams.set('limit', '50');
  return getAllPages<{ id: string; title: string }>(url, origin, creds, timeoutMs);
}

interface RawAttachment {
  id: string;
  title: string;
  metadata?: { mediaType?: string };
  version?: { number: number };
  _links?: { download?: string };
}

export async function fetchAttachments(
  apiBase: string,
  origin: string,
  pageId: string,
  creds: ConfluenceCredentials,
  timeoutMs: number
): Promise<ConfluenceAttachmentRef[]> {
  const url = new URL(`${apiBase}/content/${encodeURIComponent(pageId)}/child/attachment`);
  url.searchParams.set('limit', '50');
  url.searchParams.set('expand', 'version,metadata');
  const raw = await getAllPages<RawAttachment>(url, origin, creds, timeoutMs);
  return raw
    .filter((a) => a._links?.download)
    .map((a) => ({
      id: a.id,
      title: a.title,
      version: a.version?.number ?? 1,
      mediaType: a.metadata?.mediaType ?? '',
      downloadUrl: new URL(a._links!.download!, origin).toString(),
    }));
}

export async function downloadAttachment(
  downloadUrl: string,
  creds: ConfluenceCredentials,
  timeoutMs: number
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw new ConfluenceApiError(`Invalid attachment URL: "${downloadUrl}".`, 'validation');
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers: { Authorization: authHeader(creds) }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new ConfluenceApiError(`Confluence rejected the credentials (HTTP ${res.statusCode}).`, 'auth'));
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new ConfluenceApiError(`Confluence returned HTTP ${res.statusCode ?? '(no status)'} downloading attachment.`, 'http'));
            return;
          }
          resolve(body);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new ConfluenceApiError(`Attachment download timed out after ${timeoutMs}ms.`, 'timeout'));
    });
    req.on('error', (err) => reject(new ConfluenceApiError(`Network error downloading attachment: ${err.message}`, 'network')));
    req.end();
  });
}
