import * as vscode from 'vscode';
import { HostMessage, WebviewMessage } from '../types';
import { WORKFLOWS, getWorkflow } from '../workflows';
import { WIZARD_SCHEMAS } from '../wizards/wizardSchemas';
import { renderMarkdown, computeFileName } from '../wizards/markdownRenderer';
import {
  listSkills,
  listInstructions,
  listPrompts,
  readGithubFile,
  writeGithubFile,
} from '../github/fileDiscovery';
import { buildContext } from '../github/contextBuilder';
import { listModels, resolveModel, sendChat, testConnection } from '../copilot/copilotClient';

/**
 * Hosts the extension's sole webview (the sidebar "home page") and is the
 * single place that turns webview messages into VS Code API calls. Keeping
 * all orchestration here (rather than spreading vscode.* calls through the
 * webview) is what lets the webview itself stay pure HTML/CSS/JS with no
 * privileged capabilities -- standard webview security posture.
 */
export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'arsimTdsQe.mainView';

  private view?: vscode.WebviewView;
  private readonly cancellations = new Map<string, vscode.CancellationTokenSource>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) =>
      this.handleMessage(message).catch((error) => {
        this.post({ type: 'toast', level: 'error', message: toMessage(error) });
      })
    );
  }

  public refreshFiles(): void {
    this.sendFileLists().catch((error) => {
      this.post({ type: 'toast', level: 'error', message: toMessage(error) });
    });
  }

  private post(message: HostMessage): void {
    this.view?.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        const config = vscode.workspace.getConfiguration('arsimTdsQe');
        this.post({
          type: 'init',
          workflows: WORKFLOWS,
          defaultWorkflow: config.get('defaultWorkflow', 'test-case-creation') as never,
          wizards: WIZARD_SCHEMAS,
        });
        await this.sendFileLists();
        await this.sendModels();
        return;
      }

      case 'listModels':
        await this.sendModels();
        return;

      case 'refreshFiles':
        await this.sendFileLists();
        return;

      case 'loadPrompt': {
        const file = await readGithubFile(message.file, 200_000);
        this.post({ type: 'promptContent', file: message.file, content: file.content });
        return;
      }

      case 'savePrompt': {
        const fileName = message.fileName.trim() || message.file?.fileName || 'untitled.prompt.md';
        const relativePath = await writeGithubFile('prompt', fileName, message.content);
        this.post({ type: 'toast', level: 'info', message: `Saved prompt to ${relativePath}` });
        await this.sendFileLists();
        return;
      }

      case 'testConnection': {
        try {
          const result = await testConnection(message.modelUid);
          this.post({ type: 'testConnectionResult', ok: true, ...result });
        } catch (error) {
          this.post({ type: 'testConnectionResult', ok: false, error: toMessage(error) });
        }
        return;
      }

      case 'sendPrompt':
        await this.handleSendPrompt(message);
        return;

      case 'saveWizardFile': {
        try {
          const fileName = computeFileName(message.kind, message.data);
          const content = renderMarkdown(message.kind, message.data);
          const relativePath = await writeGithubFile(message.kind, fileName, content);
          this.post({ type: 'wizardSaved', kind: message.kind, relativePath });
          await this.sendFileLists();
        } catch (error) {
          this.post({ type: 'wizardError', message: toMessage(error) });
        }
        return;
      }

      default:
        return;
    }
  }

  private async handleSendPrompt(
    message: Extract<WebviewMessage, { type: 'sendPrompt' }>
  ): Promise<void> {
    const { requestId } = message;

    const existing = this.cancellations.get(requestId);
    existing?.cancel();
    const cts = new vscode.CancellationTokenSource();
    this.cancellations.set(requestId, cts);

    try {
      const workflow = getWorkflow(message.workflowId);
      const model = await resolveModel(message.modelUid);

      const { content, summary } = await buildContext({
        workflow,
        userText: message.userText,
        selectedSkills: message.selectedSkills,
        selectedInstructions: message.selectedInstructions,
        selectedPromptFile: message.selectedPromptFile,
      });

      this.post({ type: 'streamStart', requestId });

      await sendChat(model, workflow.systemPrompt, content, {
        token: cts.token,
        onChunk: (text) => this.post({ type: 'streamChunk', requestId, text }),
      });

      this.post({
        type: 'streamDone',
        requestId,
        contextSummary: { ...summary, modelName: model.name || model.id || 'unknown' },
      });
    } catch (error) {
      this.post({ type: 'streamError', requestId, message: toMessage(error) });
    } finally {
      this.cancellations.delete(requestId);
    }
  }

  private async sendFileLists(): Promise<void> {
    const [skills, instructions, prompts] = await Promise.all([
      listSkills(),
      listInstructions(),
      listPrompts(),
    ]);
    this.post({ type: 'files', skills, instructions, prompts });
  }

  private async sendModels(): Promise<void> {
    try {
      const models = await listModels();
      this.post({ type: 'models', models });
    } catch (error) {
      this.post({ type: 'models', models: [], error: toMessage(error) });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>ARSIM TDS QE GHCP Interface</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
