import { ServiceNowIncident } from '../types';
import { ParsedCsvFile } from '../fileIngest/parsedFile';

/**
 * Fetched incidents are represented as an ordinary `ParsedCsvFile` so they
 * flow through the *existing* attach-file pipeline unchanged (budgeting,
 * truncation, the Context Limit meter, the Control panel) -- see
 * `src/fileIngest/slice.ts`'s `selectedIncidentNumbers` branch, which
 * filters rows by the exact column name defined here.
 */
export const INCIDENT_NUMBER_COLUMN = 'Incident Number';

const COLUMNS = [
  INCIDENT_NUMBER_COLUMN,
  'Short Description',
  'Severity',
  'Priority',
  'State',
  'Created',
  'Application Code',
  'Assignment Group',
  'Category',
  'Description',
];

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Trims free-text fields so one verbose incident can't dominate the
 *  per-row budget when many incidents are included together. */
function trimmedDescription(inc: ServiceNowIncident): string {
  const text = inc.description?.trim() || inc.work_notes?.trim() || '';
  return text.length > 600 ? text.slice(0, 600) + '…' : text;
}

export function toParsedCsvFile(incidents: ServiceNowIncident[]): ParsedCsvFile {
  return {
    kind: 'csv',
    columns: COLUMNS,
    rows: incidents.map((inc) => ({
      [INCIDENT_NUMBER_COLUMN]: str(inc.number),
      'Short Description': str(inc.short_description),
      Severity: str(inc.severity),
      Priority: str(inc.priority),
      State: str(inc.state),
      Created: str(inc.sys_created_on),
      'Application Code': str(inc.cmdb_ci),
      'Assignment Group': str(inc.assignment_group),
      Category: str(inc.category),
      Description: trimmedDescription(inc),
    })),
  };
}

/** Compact rows for the Control panel's ticket-checkbox table -- meta
 *  travels to the webview even though full parsed content never does, so
 *  this is deliberately just the three columns the table needs. */
export function toIncidentRowSummaries(
  incidents: ServiceNowIncident[]
): { number: string; shortDescription: string; severity: string }[] {
  return incidents.map((inc) => ({
    number: str(inc.number),
    shortDescription: str(inc.short_description),
    severity: str(inc.severity) || str(inc.priority),
  }));
}
