import * as vscode from 'vscode';
import { MainViewProvider } from './panels/MainViewProvider';
import { forgetServiceNowPassword } from './serviceNow/serviceNowCredentials';

let activeProvider: MainViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MainViewProvider(context);
  activeProvider = provider;

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

  context.subscriptions.push(
    vscode.commands.registerCommand('arsimTdsQe.forgetServiceNowPassword', async () => {
      await forgetServiceNowPassword(context);
      vscode.window.showInformationMessage(
        'ServiceNow password cleared. You will be prompted again next time PROD Incident Analysis fetches incidents.'
      );
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  // Best-effort final flush of any not-yet-persisted token usage history.
  // Individual requests already flush immediately after completing, so
  // this is a safety net, not the primary persistence path.
  return activeProvider?.flushOnShutdown();
}
