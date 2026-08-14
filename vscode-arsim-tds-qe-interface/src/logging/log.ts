import * as vscode from 'vscode';

/**
 * A real, persistent run log -- View > Output > "ARSIM TDS QE" (or the
 * "ARSIM TDS QE: Show Logs" command). Until now the only error surface
 * was a transient toast in the sidebar with just `error.message`; this
 * gives every request (ServiceNow/Jira fetch, sendPrompt, file save,
 * etc.) a durable, timestamped trail -- including the full stack trace
 * for anything that throws, not just the one-line summary the user sees.
 *
 * Deliberately a module-level singleton rather than something threaded
 * through every constructor: `initLogger()` creates the channel once
 * during activation, and every other module just imports `log`/`logError`
 * directly -- the same low-ceremony approach already used for `post()`-
 * style helpers elsewhere in this codebase.
 */
let channel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): vscode.OutputChannel {
  channel = vscode.window.createOutputChannel('ARSIM TDS QE');
  context.subscriptions.push(channel);
  return channel;
}

export function showLogs(): void {
  channel?.show(true);
}

function stamp(): string {
  return new Date().toISOString();
}

export function log(message: string): void {
  channel?.appendLine(`[${stamp()}] ${message}`);
}

/** Logs the full error detail (message + stack when available) -- callers
 *  still show the user a short toast separately; this is the place to
 *  find out *why* when that one line isn't enough. */
export function logError(message: string, error?: unknown): void {
  let detail = '';
  if (error instanceof Error) {
    detail = error.stack ? `\n${error.stack}` : ` -- ${error.message}`;
  } else if (error !== undefined) {
    detail = ` -- ${String(error)}`;
  }
  channel?.appendLine(`[${stamp()}] ERROR: ${message}${detail}`);
}
