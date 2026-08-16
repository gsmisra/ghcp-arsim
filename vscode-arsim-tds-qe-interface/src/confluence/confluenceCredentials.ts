import * as vscode from 'vscode';

/**
 * Same pattern as src/serviceNow/serviceNowCredentials.ts: the password
 * never touches any file this extension writes -- it lives only in VS
 * Code's SecretStorage (`context.secrets`), OS-encrypted (Keychain /
 * Credential Manager / libsecret), never synced or written in plaintext.
 *
 * Unlike ServiceNow (one fixed instance) or the existing Jira wizard
 * (username/password typed into webview form fields per request), a
 * Confluence link can point at *any* site, and the Confluence importer
 * also needs Jira credentials of its own -- when a Confluence page links a
 * jtmf.td.com/track.td.com ticket, that fetch happens outside the normal
 * Jira wizard's webview form, so it can't reuse those in-memory fields.
 * Per the confirmed design: prompt each separately (native masked
 * `showInputBox`, not a webview field), and persist both the same way the
 * ServiceNow password already is -- store once, reuse until "Forget
 * Password" is run.
 */
const CONFLUENCE_USERNAME_KEY = 'arsimTdsQe.confluenceUsername';
const CONFLUENCE_PASSWORD_SECRET_KEY = 'arsimTdsQe.confluencePassword';
const JIRA_IMPORT_USERNAME_KEY = 'arsimTdsQe.jiraImportUsername';
const JIRA_IMPORT_PASSWORD_SECRET_KEY = 'arsimTdsQe.jiraImportPassword';

export interface PromptedCredentials {
  username: string;
  password: string;
}

async function getOrPromptUsername(
  context: vscode.ExtensionContext,
  globalStateKey: string,
  title: string,
  prompt: string
): Promise<string> {
  const existing = context.globalState.get<string>(globalStateKey, '').trim();
  if (existing) return existing;

  const entered = await vscode.window.showInputBox({
    title,
    prompt,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'A username is required.'),
  });
  if (!entered) {
    throw new Error(`${title} is required to continue.`);
  }
  await context.globalState.update(globalStateKey, entered.trim());
  return entered.trim();
}

async function getOrPromptPassword(
  context: vscode.ExtensionContext,
  secretKey: string,
  title: string,
  prompt: string
): Promise<string> {
  const existing = await context.secrets.get(secretKey);
  if (existing) return existing;

  const entered = await vscode.window.showInputBox({
    title,
    prompt,
    password: true,
    ignoreFocusOut: true,
  });
  if (!entered) {
    throw new Error(`${title} is required to continue.`);
  }
  await context.secrets.store(secretKey, entered);
  return entered;
}

/** Prompts for (or reuses previously stored) Confluence credentials. The
 *  site itself is never asked for here -- it's derived from the page URL
 *  the user pastes (see parseConfluenceUrl), so the same credentials
 *  prompt works no matter which Confluence instance a given link points
 *  at. */
export async function getOrPromptConfluenceCredentials(
  context: vscode.ExtensionContext
): Promise<PromptedCredentials> {
  const username = await getOrPromptUsername(
    context,
    CONFLUENCE_USERNAME_KEY,
    'Confluence Username',
    'Enter your Confluence username (used to import pages into a Knowledge Base).'
  );
  const password = await getOrPromptPassword(
    context,
    CONFLUENCE_PASSWORD_SECRET_KEY,
    'Confluence Password',
    `Enter the Confluence password for "${username}". Stored encrypted in VS Code SecretStorage -- never written to any file.`
  );
  return { username, password };
}

export async function forgetConfluencePassword(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(CONFLUENCE_PASSWORD_SECRET_KEY);
}

/**
 * Jira credentials used ONLY by the Confluence importer, when a page it's
 * scanning links a jtmf.td.com/track.td.com ticket. Deliberately separate
 * from the existing Jira wizard's webview-form credentials -- that flow
 * only ever holds its username/password in the webview's in-memory state
 * for the duration of one fetch, with no persistence, and reusing that
 * would mean either persisting it silently (a behavior change to an
 * existing, working flow) or re-prompting through a webview form from
 * extension-host code (not how that UI is built). A second, independently
 * persisted prompt keeps both flows simple and keeps this one from
 * touching the wizard at all.
 */
export async function getOrPromptJiraCredentialsForImport(
  context: vscode.ExtensionContext
): Promise<PromptedCredentials> {
  const username = await getOrPromptUsername(
    context,
    JIRA_IMPORT_USERNAME_KEY,
    'Jira Username',
    'Enter your Jira username (used to fetch tickets linked from imported Confluence pages).'
  );
  const password = await getOrPromptPassword(
    context,
    JIRA_IMPORT_PASSWORD_SECRET_KEY,
    'Jira Password',
    `Enter the Jira password for "${username}". Stored encrypted in VS Code SecretStorage -- never written to any file.`
  );
  return { username, password };
}

export async function forgetJiraImportPassword(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(JIRA_IMPORT_PASSWORD_SECRET_KEY);
}

/** Compiled-in default (tsconfig.json's confluence_max_depth via
 *  esbuild's define), overridable by the arsimTdsQe.confluenceMaxDepth
 *  setting -- which MUST default to null, not a number. VS Code's
 *  `config.get(key, default)` always returns the JS default when the
 *  setting is unset, so if the setting declared e.g. `3` as its own
 *  default, `config.get('confluenceMaxDepth', __CONFLUENCE_MAX_DEPTH__)`
 *  would never actually see the compiled-in value -- the setting's own
 *  default would silently win every time. Declaring the setting's type as
 *  `["number","null"]` with default `null` makes "unset" distinguishable
 *  from "user chose a number", so the compiled-in constant stays
 *  authoritative until a real override is present. */
export function getConfluenceMaxDepth(): number {
  const override = vscode.workspace
    .getConfiguration('arsimTdsQe')
    .get<number | null>('confluenceMaxDepth', null);
  return typeof override === 'number' && override >= 0 ? override : __CONFLUENCE_MAX_DEPTH__;
}

export function getConfluenceMaxPages(): number {
  return vscode.workspace.getConfiguration('arsimTdsQe').get<number>('confluenceMaxPages', 100);
}

export function getConfluenceTimeoutMs(): number {
  return vscode.workspace.getConfiguration('arsimTdsQe').get<number>('confluenceApiTimeoutMs', 30000);
}

export function getJiraImportTimeoutMs(): number {
  return vscode.workspace.getConfiguration('arsimTdsQe').get<number>('jiraApiTimeoutMs', 30000);
}
