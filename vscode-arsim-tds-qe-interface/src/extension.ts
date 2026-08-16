import * as vscode from 'vscode';
import { MainViewProvider } from './panels/MainViewProvider';
import { forgetServiceNowPassword } from './serviceNow/serviceNowCredentials';
import { forgetConfluencePassword, forgetJiraImportPassword } from './confluence/confluenceCredentials';
import { initLogger, log, showLogs } from './logging/log';
import { initFileDiscovery } from './github/fileDiscovery';
import { clearRetrievalCache } from './rag/retriever';

let activeProvider: MainViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);
  log('Extension activated.');
  initFileDiscovery(context.extensionUri);

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

  context.subscriptions.push(
    vscode.commands.registerCommand('arsimTdsQe.forgetConfluencePassword', async () => {
      await forgetConfluencePassword(context);
      vscode.window.showInformationMessage(
        'Confluence password cleared. You will be prompted again next time you import a Confluence page.'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('arsimTdsQe.forgetJiraImportPassword', async () => {
      await forgetJiraImportPassword(context);
      vscode.window.showInformationMessage(
        'Jira password (Confluence import) cleared. You will be prompted again next time an imported page links a ticket.'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('arsimTdsQe.showLogs', () => {
      showLogs();
    })
  );

  // Chunk size/overlap and the BM25 parameters are baked into a built
  // index, so changing any of them must invalidate every cached index --
  // otherwise the new setting silently wouldn't take effect until the
  // underlying knowledge base happened to change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      const affectsIndexing = [
        'arsimTdsQe.ragChunkChars',
        'arsimTdsQe.ragChunkOverlapChars',
        'arsimTdsQe.bm25K1',
        'arsimTdsQe.bm25B',
      ].some((key) => event.affectsConfiguration(key));
      if (affectsIndexing) {
        clearRetrievalCache();
        log('RAG indexing settings changed -- retrieval index cache cleared.');
      }
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  // Best-effort final flush of any not-yet-persisted token usage history.
  // Individual requests already flush immediately after completing, so
  // this is a safety net, not the primary persistence path.
  return activeProvider?.flushOnShutdown();
}
