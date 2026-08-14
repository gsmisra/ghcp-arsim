import * as vscode from 'vscode';
import { AttachedFileMeta, HostMessage, JiraChunkMeta, SessionTokenTotals, WebviewMessage } from '../types';
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
import { countTokens, listModels, resolveModel, sendChat, testConnection } from '../copilot/copilotClient';
import { TokenHistoryStore } from '../telemetry/tokenHistoryStore';
import { exportTokenHistoryToDownloads } from '../telemetry/csvExport';
import { promptForAdminPassword } from '../security/adminAuth';
import { AttachedFilesStore, generateFileId } from '../fileIngest/attachedFilesStore';
import { parseFile } from '../fileIngest';
import { summarizeContent } from '../fileIngest/textStats';
import { exportRowsToDownloads } from '../telemetry/csvExport';
import { fetchIncidents, buildIncidentQuery, ServiceNowApiError } from '../serviceNow/serviceNowClient';
import {
  getServiceNowUsername,
  getServiceNowInstanceUrl,
  getServiceNowTimeoutMs,
  getOrPromptServiceNowPassword,
} from '../serviceNow/serviceNowCredentials';
import { toParsedCsvFile, toIncidentRowSummaries } from '../serviceNow/serviceNowIngest';
import {
  fetchJiraIssue,
  fetchJiraAttachment,
  extractJiraKey,
  findLinkedTicketKeys,
  JiraApiError,
  JiraAttachmentRaw,
  JIRA_SITE_BASE_URLS,
} from '../jira/jiraClient';
import { flattenJiraHtml } from '../jira/htmlFlatten';
import { splitAcceptanceCriteria } from '../jira/acSplitter';
import { JiraContextStore, JiraChunkEntry } from '../jira/jiraContextStore';
import { detectKind } from '../fileIngest/detect';

const TOKEN_SESSION_STATE_KEY = 'arsimTdsQe.tokenSession';
const EMPTY_SESSION_TOTALS: SessionTokenTotals = {
  requestCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

// Defensive upper bound on picked-file size, configurable since the right
// ceiling depends on the host machine's memory, not just the file itself:
// parsing (mammoth/pdfjs/xlsx/papaparse) fully materializes the file's
// content as in-memory JS objects/strings, which for CSV/XLSX in particular
// can expand well past the on-disk byte size (each cell becomes its own JS
// string/object). Default 400MB per requirement; lower it in Settings on
// memory-constrained machines, or if a specific very large/dense file
// causes the extension host to struggle.
const DEFAULT_MAX_ATTACH_FILE_MB = 400;

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
  private sessionTotals: SessionTokenTotals;
  private readonly tokenHistory: TokenHistoryStore;
  private readonly attachedFiles = new AttachedFilesStore();
  private readonly jiraContext = new JiraContextStore();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sessionTotals = context.globalState.get<SessionTokenTotals>(
      TOKEN_SESSION_STATE_KEY,
      EMPTY_SESSION_TOTALS
    );
    this.tokenHistory = new TokenHistoryStore(context);
  }

  /** Called from `deactivate()` as a last-chance, best-effort persistence flush. */
  public flushOnShutdown(): Thenable<void> {
    return this.tokenHistory.flush();
  }

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
          defaultWorkflow: config.get('defaultWorkflow', 'generic') as never,
          wizards: WIZARD_SCHEMAS,
        });
        await this.sendFileLists();
        await this.sendModels();
        this.post({ type: 'tokenSession', session: this.sessionTotals });
        // Warm the history cache now so the "Token Usage History" link
        // opens instantly later instead of paying a disk read on first click.
        await this.tokenHistory.load();
        return;
      }

      case 'resetTokenSession': {
        const authorized = await promptForAdminPassword('reset the token usage session totals');
        if (!authorized) {
          this.post({ type: 'toast', level: 'warn', message: 'Reset session cancelled: admin password not confirmed.' });
          return;
        }
        this.sessionTotals = { ...EMPTY_SESSION_TOTALS };
        await this.context.globalState.update(TOKEN_SESSION_STATE_KEY, this.sessionTotals);
        this.post({ type: 'tokenSession', session: this.sessionTotals });
        this.post({ type: 'toast', level: 'info', message: 'Session totals reset.' });
        return;
      }

      case 'loadTokenHistory': {
        await this.tokenHistory.load();
        this.post({ type: 'tokenHistory', entries: this.tokenHistory.getAllNewestFirst() });
        return;
      }

      case 'clearTokenHistory': {
        this.tokenHistory.clear();
        await this.tokenHistory.flush();
        this.post({ type: 'tokenHistory', entries: [] });
        this.post({ type: 'toast', level: 'info', message: 'Token usage history cleared.' });
        return;
      }

      case 'exportTokenHistoryCsv': {
        if (message.entries.length === 0) {
          this.post({ type: 'toast', level: 'warn', message: 'No rows to export.' });
          return;
        }
        try {
          const fileUri = await exportTokenHistoryToDownloads(message.entries);
          const reveal = 'Reveal in Folder';
          vscode.window
            .showInformationMessage(
              `Exported ${message.entries.length} row(s) to ${fileUri.fsPath}`,
              reveal
            )
            .then((choice) => {
              if (choice === reveal) {
                vscode.commands.executeCommand('revealFileInOS', fileUri);
              }
            });
        } catch (error) {
          this.post({
            type: 'toast',
            level: 'error',
            message: `CSV export failed: ${toMessage(error)}`,
          });
        }
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
          const { model, response, promptTokens, completionTokens } = await testConnection(
            message.modelUid
          );
          const usage =
            promptTokens !== null && completionTokens !== null
              ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
              : undefined;
          this.post({ type: 'testConnectionResult', ok: true, model, response, usage });
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

      case 'browseFile':
        await this.handleBrowseFile();
        return;

      case 'updateFileSelection': {
        const entry = this.attachedFiles.updateSelection(message.fileId, message.selection);
        if (!entry) {
          this.post({
            type: 'fileAttachError',
            message: 'That attached file is no longer available -- please Browse again.',
          });
          return;
        }
        const content = this.attachedFiles.currentContent(message.fileId) ?? '';
        this.post({ type: 'fileSelectionUpdated', preview: summarizeContent(message.fileId, content) });
        return;
      }

      case 'clearAttachedFile':
        this.attachedFiles.remove(message.fileId);
        this.post({ type: 'fileCleared' });
        return;

      case 'estimateContext':
        await this.handleEstimateContext(message);
        return;

      case 'loadManagedFile': {
        const file = await readGithubFile(message.file, 200_000);
        this.post({ type: 'managedFileContent', kind: message.kind, file: message.file, content: file.content });
        return;
      }

      case 'saveManagedFile': {
        const fileName = message.fileName.trim() || message.file?.fileName || `untitled.${message.kind}.md`;
        const relativePath = await writeGithubFile(message.kind, fileName, message.content);
        this.post({ type: 'toast', level: 'info', message: `Saved ${message.kind} to ${relativePath}` });
        await this.sendFileLists();
        return;
      }

      case 'fetchIncidents':
        await this.handleFetchIncidents(message);
        return;

      case 'downloadIncidentAnalysisCsv': {
        if (message.rows.length === 0) {
          this.post({ type: 'toast', level: 'warn', message: 'No table rows to export.' });
          return;
        }
        try {
          const fileUri = await exportRowsToDownloads(message.headers, message.rows, 'prod-incident-analysis');
          const reveal = 'Reveal in Folder';
          vscode.window
            .showInformationMessage(`Exported ${message.rows.length} row(s) to ${fileUri.fsPath}`, reveal)
            .then((choice) => {
              if (choice === reveal) vscode.commands.executeCommand('revealFileInOS', fileUri);
            });
        } catch (error) {
          this.post({ type: 'toast', level: 'error', message: `CSV export failed: ${toMessage(error)}` });
        }
        return;
      }

      case 'jiraFetchTicket':
        await this.handleJiraFetchTicket(message);
        return;

      case 'updateJiraAttachmentSelection': {
        const chunk = this.jiraContext.updateAttachmentSelection(message.chunkId, message.selection);
        if (!chunk) {
          this.post({
            type: 'toast',
            level: 'warn',
            message: 'That attachment is no longer available -- fetch the ticket again.',
          });
          return;
        }
        this.post({
          type: 'jiraChunkContentUpdated',
          chunkId: message.chunkId,
          charCount: this.jiraContext.currentContent(message.chunkId).length,
        });
        return;
      }

      case 'saveFeatureFile':
        await this.handleSaveFeatureFile(message);
        return;

      default:
        return;
    }
  }

  /**
   * Fetches incidents from ServiceNow for the given MAL codes/date range
   * and wraps the result as a synthetic attached CSV file -- from this
   * point on it flows through exactly the same pipeline a real uploaded
   * CSV would (AttachedFilesStore, context budgeting/truncation, the
   * Context Limit meter, and the Control panel, which renders a
   * ticket-checkbox table instead of column/row-range controls when it
   * sees `meta.sourceKind === 'servicenow-incidents'`).
   */
  private async handleFetchIncidents(
    message: Extract<WebviewMessage, { type: 'fetchIncidents' }>
  ): Promise<void> {
    this.post({ type: 'incidentSearchBusy' });
    try {
      const username = getServiceNowUsername();
      if (!username) {
        throw new Error('Set arsimTdsQe.serviceNowUsername in Settings before fetching incidents.');
      }
      const password = await getOrPromptServiceNowPassword(this.context, username);
      const instanceUrl = getServiceNowInstanceUrl();
      const timeoutMs = getServiceNowTimeoutMs();

      const incidents = await fetchIncidents(
        { malCodes: message.malCodes, dateFrom: message.dateFrom, dateTo: message.dateTo },
        { username, password },
        instanceUrl,
        timeoutMs
      );

      const parsedCsv = toParsedCsvFile(incidents);
      const fileId = generateFileId();
      const meta: AttachedFileMeta = {
        fileId,
        fileName: `ServiceNow Incidents (${incidents.length})`,
        kind: 'csv',
        csvColumns: parsedCsv.columns,
        csvTotalRows: parsedCsv.rows.length,
        warning:
          incidents.length === 0
            ? 'No incidents were found for the given MAL code(s) and date range. Try widening the range or double-checking the codes.'
            : null,
        sourceKind: 'servicenow-incidents',
        incidentSummary: toIncidentRowSummaries(incidents),
      };
      this.attachedFiles.add(meta, parsedCsv);

      const content = this.attachedFiles.currentContent(fileId) ?? '';
      this.post({ type: 'fileAttached', meta, preview: summarizeContent(fileId, content) });
      this.post({
        type: 'incidentSearchResult',
        count: incidents.length,
        query: buildIncidentQuery({ malCodes: message.malCodes, dateFrom: message.dateFrom, dateTo: message.dateTo }),
      });
    } catch (error) {
      const kind = error instanceof ServiceNowApiError ? error.kind : null;
      const prefix = kind === 'timeout' ? 'Timed out: ' : kind === 'auth' ? 'Authentication failed: ' : '';
      this.post({ type: 'incidentSearchError', message: `${prefix}${toMessage(error)}` });
    }
  }

  /**
   * Fetches a Jira story ticket, splits its Acceptance Criteria into
   * segments, expands any linked ticket (single level -- see
   * findLinkedTicketKeys), downloads and parses csv/xlsx/docx attachments
   * (images ignored, flagged), and stores it all in JiraContextStore as a
   * list of selectable chunks -- only metadata (id/label/kind/charCount)
   * goes to the webview, never the actual content.
   */
  private async handleJiraFetchTicket(
    message: Extract<WebviewMessage, { type: 'jiraFetchTicket' }>
  ): Promise<void> {
    try {
      const baseUrl = JIRA_SITE_BASE_URLS[message.site];
      const creds = { username: message.username, password: message.password };
      const timeoutMs = vscode.workspace.getConfiguration('arsimTdsQe').get<number>('jiraApiTimeoutMs', 30000);
      const key = extractJiraKey(message.ticketUrl);

      const issue = await fetchJiraIssue(key, baseUrl, creds, timeoutMs);
      const summary = issue.fields.summary || key;
      const chunks: JiraChunkEntry[] = [];

      const renderedOrRaw = (rendered: string | null | undefined, raw: string | null | undefined): string =>
        rendered ? flattenJiraHtml(rendered) : raw || '';

      const descriptionText = renderedOrRaw(issue.renderedFields?.description, issue.fields.description);
      if (descriptionText.trim()) {
        chunks.push({ id: `${key}-description`, label: `${key} Description`, kind: 'description', content: descriptionText });
      }

      const acText = renderedOrRaw(issue.renderedFields?.customfield_14400, issue.fields.customfield_14400);
      splitAcceptanceCriteria(acText).forEach((seg, i) => {
        chunks.push({ id: `${key}-ac-${i}`, label: `${key} ${seg.label}`, kind: 'ac', content: seg.content });
      });

      // Single-level linked-ticket expansion: a link found in AC/description
      // gets fetched once; that linked ticket's own text is not scanned
      // again, so this can never recurse or run away.
      for (const linkedKey of findLinkedTicketKeys(`${descriptionText}\n${acText}`, key)) {
        try {
          const linked = await fetchJiraIssue(linkedKey, baseUrl, creds, timeoutMs);
          const linkedDesc = renderedOrRaw(linked.renderedFields?.description, linked.fields.description);
          const linkedAc = renderedOrRaw(linked.renderedFields?.customfield_14400, linked.fields.customfield_14400);
          const combined = [
            linked.fields.summary ? `Summary: ${linked.fields.summary}` : '',
            linkedDesc ? `Description:\n${linkedDesc}` : '',
            linkedAc ? `Acceptance Criteria:\n${linkedAc}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          if (combined.trim()) {
            chunks.push({ id: `${linkedKey}-linked`, label: `Linked ticket ${linkedKey}`, kind: 'linked-ticket', content: combined });
          }
        } catch {
          // A linked ticket that can't be fetched (wrong host, no access,
          // deleted) is supplementary context, not required -- skip it
          // rather than failing the whole fetch.
        }
      }

      // Attachments: only the latest upload per filename, csv/xlsx/docx
      // only (reusing the exact same parseFile() the Browse-file feature
      // uses), images ignored but flagged to the user.
      const latestByName = new Map<string, JiraAttachmentRaw>();
      for (const att of issue.fields.attachment || []) {
        const existing = latestByName.get(att.filename);
        if (!existing || new Date(att.created).getTime() > new Date(existing.created).getTime()) {
          latestByName.set(att.filename, att);
        }
      }
      const ignoredImages: string[] = [];
      for (const att of latestByName.values()) {
        const kind = detectKind(att.filename);
        if (kind !== 'csv' && kind !== 'xlsx' && kind !== 'docx') {
          if (/\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(att.filename)) ignoredImages.push(att.filename);
          continue;
        }
        try {
          const buffer = await fetchJiraAttachment(att.content, creds, timeoutMs);
          const attachmentId = `${key}-att-${att.id}`;
          const { parsed, meta } = await parseFile(buffer, att.filename, attachmentId);
          chunks.push({ id: attachmentId, label: `Attachment: ${att.filename}`, kind: 'attachment', parsed, meta });
        } catch (error) {
          this.post({
            type: 'toast',
            level: 'warn',
            message: `Could not read attachment "${att.filename}": ${toMessage(error)}`,
          });
        }
      }

      this.jiraContext.reset(chunks);

      const chunkMetas: JiraChunkMeta[] = chunks.map((c) => ({
        id: c.id,
        label: c.label,
        kind: c.kind,
        charCount: this.jiraContext.currentContent(c.id).length,
        attachmentMeta: c.meta,
      }));

      this.post({ type: 'jiraTicketFetched', ticketKey: key, summary, chunks: chunkMetas });
      if (ignoredImages.length > 0) {
        this.post({
          type: 'toast',
          level: 'info',
          message: `${ignoredImages.length} image attachment(s) detected and ignored: ${ignoredImages.join(', ')}`,
        });
      }
    } catch (error) {
      const kind = error instanceof JiraApiError ? error.kind : null;
      const prefix = kind === 'timeout' ? 'Timed out: ' : kind === 'auth' ? 'Authentication failed: ' : '';
      this.post({ type: 'jiraTicketError', message: `${prefix}${toMessage(error)}` });
    }
  }

  private async handleSaveFeatureFile(
    message: Extract<WebviewMessage, { type: 'saveFeatureFile' }>
  ): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      this.post({ type: 'featureFileSaveError', message: 'Open a workspace folder before saving the feature file.' });
      return;
    }
    try {
      const rawName = (message.fileNameHint.trim() || 'feature').replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '');
      const fileName = rawName.toLowerCase().endsWith('.feature') ? rawName : `${rawName}.feature`;
      const relDir = message.relativePath.trim().replace(/^[/\\]+/, '');
      const dirUri = relDir ? vscode.Uri.joinPath(root.uri, relDir) : root.uri;
      await vscode.workspace.fs.createDirectory(dirUri);

      const fileUri = vscode.Uri.joinPath(dirUri, fileName);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(message.content, 'utf-8'));

      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });

      this.post({ type: 'featureFileSaved', path: vscode.workspace.asRelativePath(fileUri, false) });
    } catch (error) {
      this.post({ type: 'featureFileSaveError', message: toMessage(error) });
    }
  }

  private async handleBrowseFile(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Attach to Request',
      filters: {
        'Supported documents': ['docx', 'pdf', 'csv', 'xlsx', 'xls', 'txt', 'md', 'log', 'json'],
        'All files': ['*'],
      },
    });
    if (!picked || picked.length === 0) {
      // User cancelled -- not an error, but the webview already flipped into
      // its "parsing" state optimistically on click, so it must be told to
      // stand down or the Browse button would stay disabled for the rest of
      // the session.
      this.post({ type: 'fileCleared' });
      return;
    }

    const uri = picked[0];
    this.post({ type: 'fileParsing' });

    try {
      const maxMb = vscode.workspace
        .getConfiguration('arsimTdsQe')
        .get<number>('maxAttachFileSizeMB', DEFAULT_MAX_ATTACH_FILE_MB);
      const maxBytes = maxMb * 1024 * 1024;

      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxBytes) {
        throw new Error(
          `File is ${(stat.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${maxMb} MB attach limit (arsimTdsQe.maxAttachFileSizeMB).`
        );
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      // Wrap without copying: Buffer.from(bytes) would allocate and copy a
      // second full-size buffer, doubling peak memory during the moment
      // that matters most for a large attachment. Buffer.from(arrayBuffer,
      // offset, length) instead views the same underlying memory.
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const fileName = uri.path.split('/').pop() || 'attached-file';
      const fileId = generateFileId();

      const { parsed, meta } = await parseFile(buffer, fileName, fileId);
      this.attachedFiles.add(meta, parsed);

      // A large source file almost always means the model's context window
      // will be the binding constraint, not this extension -- point the
      // user at the range/column/sheet controls proactively rather than
      // waiting for them to hit the Context Limit bar's exceeded state.
      const sizeMb = stat.size / (1024 * 1024);
      if (sizeMb > 100) {
        const sizeNote = `This is a large file (${sizeMb.toFixed(0)} MB). Use "Control the data sent in the context" below to narrow what's actually sent to the model -- the full extracted content may exceed its context window.`;
        meta.warning = meta.warning ? `${meta.warning} ${sizeNote}` : sizeNote;
      }

      const content = this.attachedFiles.currentContent(fileId) ?? '';
      this.post({ type: 'fileAttached', meta, preview: summarizeContent(fileId, content) });
    } catch (error) {
      this.post({ type: 'fileAttachError', message: toMessage(error) });
    }
  }

  private async handleEstimateContext(
    message: Extract<WebviewMessage, { type: 'estimateContext' }>
  ): Promise<void> {
    try {
      const workflow = getWorkflow(message.workflowId);
      const model = await resolveModel(message.modelUid);
      const maxTokens = typeof model.maxInputTokens === 'number' ? model.maxInputTokens : null;

      const attachedFile = message.attachedFileId
        ? this.buildAttachedFilePayload(message.attachedFileId)
        : null;
      const jiraChunks = message.jiraChunkIds ? this.jiraContext.contentFor(message.jiraChunkIds) : undefined;

      const { summary, promptTokens } = await buildContext({
        workflow,
        userText: message.userText,
        selectedSkills: message.selectedSkills,
        selectedInstructions: message.selectedInstructions,
        selectedPromptFile: message.selectedPromptFile,
        attachedFile,
        jiraChunks,
        modelMaxInputTokens: maxTokens,
        countTokens: (text) => countTokens(model, vscode.LanguageModelChatMessage.User(text)),
      });

      const usedTokens = promptTokens ?? 0;
      const exceeded = maxTokens !== null && usedTokens > maxTokens;

      this.post({
        type: 'contextMeter',
        usedTokens,
        maxTokens,
        exceeded,
        lastLineIncluded: exceeded ? summary.attachedFileLastLine : null,
      });
    } catch {
      // Context estimation is advisory-only UI feedback -- a failure here
      // (e.g. no model selected yet) should never surface as an error toast.
    }
  }

  private buildAttachedFilePayload(fileId: string): { fileName: string; content: string } | null {
    const entry = this.attachedFiles.get(fileId);
    if (!entry) return null;
    const content = this.attachedFiles.currentContent(fileId) ?? '';
    return { fileName: entry.meta.fileName, content };
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
      const attachedFile = message.attachedFileId
        ? this.buildAttachedFilePayload(message.attachedFileId)
        : null;
      const jiraChunks = message.jiraChunkIds ? this.jiraContext.contentFor(message.jiraChunkIds) : undefined;

      // The context budget (and, when possible, the exact token count
      // reported below) is derived from *this* model's real
      // maxInputTokens, recomputed fresh on every send -- switch to a
      // bigger-window model and more of an attached document goes
      // through by design, not just up to a fixed character ceiling.
      const maxInputTokens = typeof model.maxInputTokens === 'number' ? model.maxInputTokens : null;

      const { content, summary, promptTokens: computedPromptTokens } = await buildContext({
        workflow,
        userText: message.userText,
        selectedSkills: message.selectedSkills,
        selectedInstructions: message.selectedInstructions,
        selectedPromptFile: message.selectedPromptFile,
        attachedFile,
        jiraChunks,
        modelMaxInputTokens: maxInputTokens,
        countTokens: (text) => countTokens(model, vscode.LanguageModelChatMessage.User(text), cts.token),
      });

      // buildContext() already measured this against the model's real
      // tokenizer as part of budgeting (when a real token budget was
      // available); reuse that instead of counting a second time. Falls
      // back to a fresh count only if that didn't happen (e.g. model
      // reported no maxInputTokens).
      const promptTokens =
        computedPromptTokens ??
        (await (async () => {
          const [systemTokens, contentTokens] = await Promise.all([
            countTokens(model, vscode.LanguageModelChatMessage.User(workflow.systemPrompt), cts.token),
            countTokens(model, vscode.LanguageModelChatMessage.User(content), cts.token),
          ]);
          return (systemTokens ?? 0) + (contentTokens ?? 0);
        })());
      this.post({ type: 'promptTokenCounted', requestId, promptTokens });

      this.post({ type: 'streamStart', requestId });

      const responseText = await sendChat(model, workflow.systemPrompt, content, {
        token: cts.token,
        onChunk: (text) => this.post({ type: 'streamChunk', requestId, text }),
      });

      const completionTokens = (await countTokens(model, responseText, cts.token)) ?? 0;
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };

      this.sessionTotals = {
        requestCount: this.sessionTotals.requestCount + 1,
        promptTokens: this.sessionTotals.promptTokens + usage.promptTokens,
        completionTokens: this.sessionTotals.completionTokens + usage.completionTokens,
        totalTokens: this.sessionTotals.totalTokens + usage.totalTokens,
      };
      await this.context.globalState.update(TOKEN_SESSION_STATE_KEY, this.sessionTotals);

      // Append to the durable, in-memory-then-flushed history log for this
      // interaction. Flushing immediately (rather than only on shutdown)
      // means a crash or forced window close never loses a completed
      // request's usage record.
      this.tokenHistory.record({
        workflowId: workflow.id,
        workflowLabel: workflow.label,
        modelName: model.name || model.id || 'unknown',
        usage,
      });
      await this.tokenHistory.flush();

      this.post({
        type: 'streamDone',
        requestId,
        contextSummary: { ...summary, modelName: model.name || model.id || 'unknown' },
        usage,
        session: this.sessionTotals,
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
