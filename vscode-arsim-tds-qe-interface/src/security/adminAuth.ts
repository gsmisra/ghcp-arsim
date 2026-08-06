import * as vscode from 'vscode';

/**
 * NOTE ON THREAT MODEL: this is a UI speed bump for the "Reset Session"
 * action, not an access-control boundary. `__ADMIN_PASSWORD__` is a literal
 * string baked into dist/extension.js at build time (see esbuild.js), so
 * anyone who unzips the .vsix can read it in plaintext. It stops a casual
 * click; it does not stop a determined user. Good enough for "for now" as
 * requested -- flagged here so it's never mistaken for real security later.
 */
export async function promptForAdminPassword(actionLabel: string): Promise<boolean> {
  const entered = await vscode.window.showInputBox({
    title: 'Admin Password Required',
    prompt: `Enter the admin password to ${actionLabel}.`,
    password: true, // masks input exactly like a native password field
    ignoreFocusOut: true,
    placeHolder: 'Password',
  });

  if (entered === undefined) {
    // User cancelled (Escape / clicked away) -- not a wrong-password case.
    return false;
  }

  return entered === __ADMIN_PASSWORD__;
}
