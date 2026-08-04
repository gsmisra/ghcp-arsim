import * as vscode from 'vscode';
import { MainViewProvider } from './panels/MainViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MainViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MainViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('arsimTdsQe.open', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.arsimTdsQe');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('arsimTdsQe.refresh', () => {
      provider.refreshFiles();
    })
  );
}

export function deactivate(): void {
  // No background resources (no localhost servers, no timers) are held by
  // this extension, so there is nothing to tear down explicitly.
}
