import * as vscode from 'vscode';

/**
 * The ServiceNow password is a real production credential -- it never goes
 * into any file this extension writes (not tsconfig.json, not a setting,
 * not global state). It lives only in VS Code's SecretStorage
 * (`context.secrets`), which VS Code encrypts using the OS credential
 * store (Keychain / Credential Manager / libsecret) and never syncs or
 * writes in plaintext to disk. The username is not secret, so it's a
 * normal, visible extension setting like everything else under
 * `arsimTdsQe.*`.
 */
const PASSWORD_SECRET_KEY = 'arsimTdsQe.serviceNowPassword';
const DEFAULT_INSTANCE_URL = 'https://tdbfa.service-now.com';
const DEFAULT_TIMEOUT_MS = 30000;

export function getServiceNowUsername(): string {
  return vscode.workspace.getConfiguration('arsimTdsQe').get<string>('serviceNowUsername', '').trim();
}

export function getServiceNowInstanceUrl(): string {
  return vscode.workspace
    .getConfiguration('arsimTdsQe')
    .get<string>('serviceNowInstanceUrl', DEFAULT_INSTANCE_URL)
    .trim();
}

export function getServiceNowTimeoutMs(): number {
  return vscode.workspace.getConfiguration('arsimTdsQe').get<number>('serviceNowApiTimeoutMs', DEFAULT_TIMEOUT_MS);
}

/**
 * Returns the stored password, prompting once (native masked VS Code input
 * box, not a webview field) the first time it's needed. Stored for the
 * rest of this VS Code install until explicitly forgotten -- re-prompting
 * on every single fetch would be an enterprise-workflow annoyance, not a
 * meaningful extra security boundary, since SecretStorage is already
 * encrypted at rest.
 */
export async function getOrPromptServiceNowPassword(
  context: vscode.ExtensionContext,
  username: string
): Promise<string> {
  const existing = await context.secrets.get(PASSWORD_SECRET_KEY);
  if (existing) return existing;

  const entered = await vscode.window.showInputBox({
    title: 'ServiceNow Password',
    prompt: `Enter the ServiceNow password for "${username}" (used only for PROD Incident Analysis). Stored encrypted in VS Code SecretStorage -- never written to any file.`,
    password: true,
    ignoreFocusOut: true,
  });

  if (!entered) {
    throw new Error('A ServiceNow password is required to fetch incidents.');
  }
  await context.secrets.store(PASSWORD_SECRET_KEY, entered);
  return entered;
}

export async function forgetServiceNowPassword(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(PASSWORD_SECRET_KEY);
}
