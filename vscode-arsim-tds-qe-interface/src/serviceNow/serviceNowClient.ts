import * as https from 'https';
import { ServiceNowIncident } from '../types';

/**
 * First real outbound HTTP client in this extension (everything else goes
 * through `vscode.lm`). Kept deliberately small and dependency-free (Node's
 * built-in `https`, no fetch polyfill/axios) since this is a single GET
 * endpoint with basic auth -- pulling in an HTTP client library for that
 * would be more surface area than the problem needs.
 */

export interface IncidentSearchParams {
  malCodes: string[];
  /** 'YYYY-MM-DD' */
  dateFrom: string;
  /** 'YYYY-MM-DD' */
  dateTo: string;
}

export interface ServiceNowCredentials {
  username: string;
  password: string;
}

export type ServiceNowErrorKind = 'network' | 'timeout' | 'auth' | 'http' | 'parse' | 'validation';

export class ServiceNowApiError extends Error {
  constructor(message: string, public readonly kind: ServiceNowErrorKind) {
    super(message);
    this.name = 'ServiceNowApiError';
  }
}

/** Fields requested from the `incident` table -- kept to exactly what the
 *  workflow uses, both to keep the response small and to keep the mapping
 *  in serviceNowIngest.ts predictable. */
const INCIDENT_FIELDS = [
  'sys_id',
  'number',
  'short_description',
  'severity',
  'priority',
  'state',
  'sys_created_on',
  'cmdb_ci',
  'assignment_group',
  'description',
  'work_notes',
  'category',
];

/**
 * Builds the `sysparm_query` string. The three inputs the UI collects (MAL
 * codes, from date, to date) are exactly the parameterized pieces of the
 * fixed query shape: `cmdb_ci.u_application_codeIN<codes>^sys_created_on>=
 * <from> 00:00:00^sys_created_on<<to> 00:00:00`. Exported (not just used
 * internally) so it can be unit-exercised and so the fetched-result summary
 * line can show the user exactly what was queried.
 */
export function buildIncidentQuery(params: IncidentSearchParams): string {
  const codes = Array.from(
    new Set(
      params.malCodes
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    )
  );
  if (codes.length === 0) {
    throw new ServiceNowApiError('Enter at least one MAL code.', 'validation');
  }
  if (!params.dateFrom || !params.dateTo) {
    throw new ServiceNowApiError('Select both a from date and a to date.', 'validation');
  }

  const fromStamp = `${params.dateFrom} 00:00:00`;
  const toStamp = `${params.dateTo} 00:00:00`;
  return `cmdb_ci.u_application_codeIN${codes.join(',')}^sys_created_on>=${fromStamp}^sys_created_on<${toStamp}`;
}

export function fetchIncidents(
  params: IncidentSearchParams,
  creds: ServiceNowCredentials,
  instanceUrl: string,
  timeoutMs: number
): Promise<ServiceNowIncident[]> {
  const query = buildIncidentQuery(params);

  let url: URL;
  try {
    url = new URL('/api/now/v1/table/incident', instanceUrl);
  } catch {
    throw new ServiceNowApiError(`Invalid ServiceNow instance URL: "${instanceUrl}".`, 'validation');
  }
  url.searchParams.set('sysparm_query', query);
  url.searchParams.set('sysparm_fields', INCIDENT_FIELDS.join(','));
  // Reference/choice fields (severity, priority, state, cmdb_ci,
  // assignment_group) come back as plain display strings instead of
  // ServiceNow's {value, display_value} objects -- keeps the mapping in
  // serviceNowIngest.ts a straight string read, and keeps severity text
  // (e.g. "1 - Critical") in a form the severity classifier can match on.
  url.searchParams.set('sysparm_display_value', 'true');
  url.searchParams.set('sysparm_limit', '1000');

  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(
              new ServiceNowApiError(
                `ServiceNow rejected the credentials (HTTP ${res.statusCode}). Run "ARSIM TDS QE: Forget ServiceNow Password" from the Command Palette and try again.`,
                'auth'
              )
            );
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new ServiceNowApiError(
                `ServiceNow API returned HTTP ${res.statusCode ?? '(no status)'}: ${body.slice(0, 300)}`,
                'http'
              )
            );
            return;
          }

          try {
            const parsed = JSON.parse(body) as { result?: ServiceNowIncident[] };
            resolve(parsed.result ?? []);
          } catch {
            reject(new ServiceNowApiError('Could not parse the ServiceNow response as JSON.', 'parse'));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new ServiceNowApiError(`ServiceNow request timed out after ${timeoutMs}ms.`, 'timeout'));
    });
    req.on('error', (err) => {
      reject(new ServiceNowApiError(`Network error contacting ServiceNow: ${err.message}`, 'network'));
    });
    req.end();
  });
}
