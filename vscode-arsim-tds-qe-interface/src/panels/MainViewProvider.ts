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
import {
  countTokens,
  getModelUid,
  listModels,
  orderedCandidateModels,
  sendChatWithFallback,
  testConnection,
} from '../copilot/copilotClient';
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
  ACCEPTANCE_CRITERIA_FIELD_BY_SITE,
} from '../jira/jiraClient';
import { flattenHtml } from '../common/htmlFlatten';
import { splitAcceptanceCriteria } from '../jira/acSplitter';
import { JiraContextStore, JiraChunkEntry } from '../jira/jiraContextStore';
import { detectKind } from '../fileIngest/detect';
import { log, logError } from '../logging/log';
import { KnowledgeBaseStore } from '../knowledgeBase/knowledgeBaseStore';
import { retrieve, warmIndexes } from '../rag/retriever';
import { sliceParsedFile } from '../fileIngest/slice';
import {
  parseConfluenceUrl,
  resolvePageId,
  fetchPage as fetchConfluencePage,
  fetchChildPages as fetchConfluenceChildPages,
  fetchAttachments as fetchConfluenceAttachments,
  downloadAttachment as downloadConfluenceAttachment,
  ConfluenceApiError,
} from '../confluence/confluenceClient';
import {
  getOrPromptConfluenceCredentials,
  getOrPromptJiraCredentialsForImport,
  getConfluenceMaxDepth,
  getConfluenceMaxPages,
  getConfluenceTimeoutMs,
  getJiraImportTimeoutMs,
} from '../confluence/confluenceCredentials';
import { importConfluenceTree, ConfluenceImportPorts } from '../confluence/confluenceImporter';

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
  private readonly knowledgeBases: KnowledgeBaseStore;
  /** Set the moment a real send confirms a model actually responds (see
   *  handleSendPrompt's use of sendChatWithFallback). Preferred over
   *  whatever the webview's default-selected model is for every
   *  *estimate* call afterwards -- the estimate path never itself
   *  retries with a fallback model (it must stay fast/side-effect-free),
   *  so once the send path has proven which model genuinely works this
   *  session, reusing it is what stops the Context Limit meter from
   *  repeatedly stalling against a model that's already known to not
   *  respond. */
  private lastWorkingModelUid: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sessionTotals = context.globalState.get<SessionTokenTotals>(
      TOKEN_SESSION_STATE_KEY,
      EMPTY_SESSION_TOTALS
    );
    this.tokenHistory = new TokenHistoryStore(context);
    this.knowledgeBases = new KnowledgeBaseStore(context);
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
        // The toast only ever shows the user a one-line message; the log
        // gets the full detail (stack trace when there is one) -- see
        // "ARSIM TDS QE: Show Logs" / View > Output > "ARSIM TDS QE".
        logError(`Unhandled error while processing "${message.type}"`, error);
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
    // Skipped for 'estimateContext': it fires on a 500ms debounce for
    // every keystroke pause and would drown out everything else in the
    // log for no real benefit (it's advisory-only UI feedback -- see
    // handleEstimateContext's own comment).
    if (message.type !== 'estimateContext') {
      log(`Handling message: ${message.type}`);
    }
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
        await this.sendKnowledgeBases();
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

      case 'listKnowledgeBases':
        await this.sendKnowledgeBases();
        return;

      case 'createKnowledgeBase': {
        try {
          const kb = await this.knowledgeBases.create(message.tier, message.name, message.description);
          log(`Knowledge base created: ${kb.id}`);
          await this.sendKnowledgeBases();
          this.post({ type: 'toast', level: 'info', message: `Created knowledge base "${kb.name}".` });
        } catch (error) {
          logError('Creating the knowledge base failed', error);
          this.post({ type: 'knowledgeBaseError', message: toMessage(error) });
        }
        return;
      }

      case 'deleteKnowledgeBase': {
        try {
          await this.knowledgeBases.delete(message.knowledgeBaseId);
          log(`Knowledge base deleted: ${message.knowledgeBaseId}`);
          await this.sendKnowledgeBases();
        } catch (error) {
          logError('Deleting the knowledge base failed', error);
          this.post({ type: 'knowledgeBaseError', message: toMessage(error) });
        }
        return;
      }

      case 'importKnowledgeBaseDocument':
        await this.handleImportKnowledgeBaseDocument(message);
        return;

      case 'importConfluencePage':
        await this.handleImportConfluencePage(message);
        return;

      case 'removeKnowledgeBaseDocument': {
        try {
          await this.knowledgeBases.removeDocument(message.knowledgeBaseId, message.documentId);
          await this.sendKnowledgeBases();
        } catch (error) {
          logError('Removing the knowledge-base document failed', error);
          this.post({ type: 'knowledgeBaseError', message: toMessage(error) });
        }
        return;
      }

      default:
        return;
    }
  }

  private async sendKnowledgeBases(): Promise<void> {
    await this.knowledgeBases.refresh();
    this.post({ type: 'knowledgeBases', knowledgeBases: this.knowledgeBases.listMeta() });
  }

  /**
   * Imports a document into a knowledge base by reusing the exact same
   * parsing pipeline the Browse-to-attach feature uses (parseFile +
   * sliceParsedFile) -- so docx/pdf/csv/xlsx/text all become indexable
   * plain text with no new parsing code, and any format the extension can
   * already read is automatically supported here too.
   */
  private async handleImportKnowledgeBaseDocument(
    message: Extract<WebviewMessage, { type: 'importKnowledgeBaseDocument' }>
  ): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Add to Knowledge Base',
      filters: {
        'Supported documents': ['md', 'txt', 'docx', 'pdf', 'csv', 'xlsx', 'xls', 'log', 'json'],
        'All files': ['*'],
      },
    });
    if (!picked || picked.length === 0) return; // cancelled -- not an error

    this.post({ type: 'knowledgeBaseImporting' });
    try {
      const uri = picked[0];
      const bytes = await vscode.workspace.fs.readFile(uri);
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const fileName = uri.path.split('/').pop() || 'document';

      const { parsed } = await parseFile(buffer, fileName, generateFileId());
      // Empty selection = the whole document, which is what we want when
      // indexing: retrieval decides relevance later, per query.
      const text = sliceParsedFile(parsed, {});

      const doc = await this.knowledgeBases.addDocument(
        message.knowledgeBaseId,
        fileName,
        text,
        vscode.workspace.asRelativePath(uri, false)
      );
      log(`Knowledge base document added: ${fileName} (${text.length} chars) -> ${message.knowledgeBaseId}`);
      await this.sendKnowledgeBases();
      this.post({
        type: 'toast',
        level: 'info',
        message: `Added "${doc.title}" (${text.length.toLocaleString()} chars) to the knowledge base.`,
      });
    } catch (error) {
      logError('Importing the knowledge-base document failed', error);
      this.post({ type: 'knowledgeBaseError', message: toMessage(error) });
    }
  }

  /**
   * Imports a Confluence page and its sub-page tree (default depth from
   * __CONFLUENCE_MAX_DEPTH__, overridable via arsimTdsQe.confluenceMaxDepth),
   * the latest version of every supported attachment on each page, and any
   * jtmf.td.com/track.td.com Jira tickets linked from the pages -- one KB
   * document per page/attachment/ticket, per the confirmed design, so
   * retrieval can cite the specific sub-page or ticket rather than just the
   * root. Jira credentials are only prompted for if a link is actually
   * found (most Confluence pages have none), and only once per session.
   */
  private async handleImportConfluencePage(
    message: Extract<WebviewMessage, { type: 'importConfluencePage' }>
  ): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: 'Import from Confluence',
      prompt:
        'Paste a Confluence page URL. Its sub-pages (up to the configured depth), attachments, and any linked Jira tickets will be imported.',
      placeHolder: 'https://confluence.example.com/display/SPACE/Page+Title',
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'A Confluence page URL is required.'),
    });
    if (!url) return; // cancelled -- not an error

    let parsed;
    try {
      parsed = parseConfluenceUrl(url);
    } catch (error) {
      this.post({ type: 'knowledgeBaseError', message: toMessage(error) });
      return;
    }

    let confluenceCreds;
    try {
      confluenceCreds = await getOrPromptConfluenceCredentials(this.context);
    } catch (error) {
      this.post({ type: 'knowledgeBaseError', message: toMessage(error) });
      return;
    }

    this.post({ type: 'knowledgeBaseImporting' });
    const timeoutMs = getConfluenceTimeoutMs();
    // Jira creds are prompted lazily (only if a link actually turns up)
    // and cached for the rest of this one import.
    let jiraCreds: { username: string; password: string } | undefined;

    const cancellation = { cancelled: false };
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Importing from Confluence (${parsed.origin})`,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            cancellation.cancelled = true;
          });

          const rootPageId = await resolvePageId(parsed, confluenceCreds, timeoutMs);

          const ports: ConfluenceImportPorts = {
            fetchPage: (id) => fetchConfluencePage(parsed.apiBase, parsed.origin, id, confluenceCreds, timeoutMs),
            fetchChildPages: (id) =>
              fetchConfluenceChildPages(parsed.apiBase, parsed.origin, id, confluenceCreds, timeoutMs),
            fetchAttachments: (id) =>
              fetchConfluenceAttachments(parsed.apiBase, parsed.origin, id, confluenceCreds, timeoutMs),
            downloadAttachment: (downloadUrl) => downloadConfluenceAttachment(downloadUrl, confluenceCreds, timeoutMs),
            parseAttachmentText: async (buffer, fileName) => {
              try {
                const { parsed: parsedFile } = await parseFile(buffer, fileName, generateFileId());
                return sliceParsedFile(parsedFile, {});
              } catch (error) {
                logError(`Could not parse Confluence attachment "${fileName}"`, error);
                return null;
              }
            },
            fetchJiraTicketText: async (site, key) => {
              try {
                if (!jiraCreds) jiraCreds = await getOrPromptJiraCredentialsForImport(this.context);
                const baseUrl = JIRA_SITE_BASE_URLS[site];
                const issue = await fetchJiraIssue(key, baseUrl, jiraCreds, getJiraImportTimeoutMs());
                const acFieldKey = ACCEPTANCE_CRITERIA_FIELD_BY_SITE[site];
                const rendered = issue.renderedFields?.[acFieldKey];
                const ac =
                  typeof rendered === 'string' && rendered
                    ? flattenHtml(rendered)
                    : typeof issue.fields[acFieldKey] === 'string'
                      ? (issue.fields[acFieldKey] as string)
                      : '';
                const description =
                  typeof issue.renderedFields?.description === 'string' && issue.renderedFields.description
                    ? flattenHtml(issue.renderedFields.description)
                    : issue.fields.description || '';
                const text = [
                  `Summary: ${issue.fields.summary}`,
                  description ? `Description:\n${description}` : '',
                  ac ? `Acceptance Criteria:\n${ac}` : '',
                ]
                  .filter(Boolean)
                  .join('\n\n');
                return { title: issue.fields.summary, text };
              } catch (error) {
                logError(`Linked Jira ticket ${site}:${key} could not be fetched, skipped`, error);
                return null;
              }
            },
            onProgress: (info) => {
              progress.report({ message: info.message });
              log(`Confluence import: ${info.message}`);
            },
            isCancelled: () => cancellation.cancelled,
          };

          const result = await importConfluenceTree(rootPageId, getConfluenceMaxDepth(), getConfluenceMaxPages(), ports);

          for (const item of result.items) {
            await this.knowledgeBases.addDocument(message.knowledgeBaseId, item.title, item.text, item.sourceRef);
          }

          const pageCount = result.items.filter((i) => i.kind === 'page').length;
          log(
            `Confluence import complete: ${pageCount} page(s), ${result.attachmentsFetched} attachment(s) ` +
              `(${result.attachmentsSkipped} skipped), ${result.jiraTicketsFetched} Jira ticket(s)` +
              `${result.stoppedEarly ? ' -- stopped early (page cap or cancelled)' : ''} -> ${message.knowledgeBaseId}`
          );
          await this.sendKnowledgeBases();

          if (result.cancelled) {
            this.post({ type: 'toast', level: 'warn', message: 'Confluence import cancelled.' });
          } else {
            this.post({
              type: 'toast',
              level: 'info',
              message:
                `Imported ${pageCount} page(s), ${result.attachmentsFetched} attachment(s), ` +
                `${result.jiraTicketsFetched} Jira ticket(s) from Confluence.` +
                (result.stoppedEarly ? ' Stopped early: page limit reached.' : ''),
            });
          }
        }
      );
    } catch (error) {
      logError('Confluence import failed', error);
      const message2 =
        error instanceof ConfluenceApiError ? error.message : toMessage(error);
      this.post({ type: 'knowledgeBaseError', message: message2 });
    } finally {
      // knowledgeBaseImporting has no explicit "done" message -- the
      // knowledgeBases refresh above (or the error path) is what clears
      // state.kbImporting in the webview, mirroring the file-import path.
      await this.sendKnowledgeBases();
    }
  }

  /**
   * Workflows whose whole point is "answer from whatever knowledge base
   * material is relevant" auto-scan every knowledge base the user has --
   * bundled, workspace, AND personal -- when they haven't narrowed the
   * scope themselves, rather than silently retrieving nothing until a
   * checkbox is ticked. An explicit selection (narrowing to just one or
   * two KBs) is still honored; this only fills in the *default*.
   * Deliberately NOT applied to workflows with their own dedicated context
   * source (Jira, ServiceNow) -- those shouldn't have unrelated KB content
   * injected by default.
   */
  private static readonly AUTO_SCAN_ALL_WORKFLOWS = new Set(['generic', 'knowledge-base-qa']);

  /** Resolves which knowledge bases a request should actually search:
   *  the user's explicit selection when there is one, otherwise every
   *  knowledge base that currently exists (for the workflows above). */
  private effectiveKnowledgeBaseIds(workflowId: string, selected: string[] | null | undefined): string[] {
    if (selected && selected.length > 0) return selected;
    if (!MainViewProvider.AUTO_SCAN_ALL_WORKFLOWS.has(workflowId)) return [];
    return this.knowledgeBases.getAll().map((kb) => kb.id);
  }

  /** Shared by send and estimate: retrieval is a no-op (returns []) when
   *  no Knowledge Base is in scope, so every pre-RAG path is unaffected. */
  private retrieveForRequest(knowledgeBaseIds: string[] | null | undefined, query: string) {
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return undefined;
    const chunks = retrieve(this.knowledgeBases, knowledgeBaseIds, query);
    return chunks.length > 0 ? chunks : undefined;
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

      log(`ServiceNow fetch: ${instanceUrl} malCodes=[${message.malCodes.join(', ')}] ${message.dateFrom}..${message.dateTo}`);
      const incidents = await fetchIncidents(
        { malCodes: message.malCodes, dateFrom: message.dateFrom, dateTo: message.dateTo },
        { username, password },
        instanceUrl,
        timeoutMs
      );
      log(`ServiceNow fetch OK: ${incidents.length} incident(s) returned`);

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
      logError('ServiceNow fetch failed', error);
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
      // The Acceptance Criteria custom field id differs per instance --
      // jtmf.td.com is customfield_10200, track.td.com is customfield_14400.
      const acFieldKey = ACCEPTANCE_CRITERIA_FIELD_BY_SITE[message.site];
      const creds = { username: message.username, password: message.password };
      const timeoutMs = vscode.workspace.getConfiguration('arsimTdsQe').get<number>('jiraApiTimeoutMs', 30000);
      const key = extractJiraKey(message.ticketUrl);

      log(`Jira fetch: ${baseUrl} ${key} (AC field: ${acFieldKey})`);
      const issue = await fetchJiraIssue(key, baseUrl, creds, timeoutMs);
      const summary = issue.fields.summary || key;
      const chunks: JiraChunkEntry[] = [];

      const renderedOrRaw = (rendered: unknown, raw: unknown): string => {
        if (typeof rendered === 'string' && rendered) return flattenHtml(rendered);
        return typeof raw === 'string' ? raw : '';
      };

      const descriptionText = renderedOrRaw(issue.renderedFields?.description, issue.fields.description);
      if (descriptionText.trim()) {
        chunks.push({ id: `${key}-description`, label: `${key} Description`, kind: 'description', content: descriptionText });
      }

      const acText = renderedOrRaw(issue.renderedFields?.[acFieldKey], issue.fields[acFieldKey]);
      log(`Jira AC field "${acFieldKey}" for ${key}: ${acText.trim() ? `${acText.length} char(s)` : 'empty/not present'}`);
      splitAcceptanceCriteria(acText).forEach((seg, i) => {
        chunks.push({ id: `${key}-ac-${i}`, label: `${key} ${seg.label}`, kind: 'ac', content: seg.content });
      });

      // Single-level linked-ticket expansion: a link found in AC/description
      // gets fetched once; that linked ticket's own text is not scanned
      // again, so this can never recurse or run away. Linked tickets are
      // assumed to be on the same site as the primary ticket (both known
      // hosts share this workflow's site selection either way).
      for (const linkedKey of findLinkedTicketKeys(`${descriptionText}\n${acText}`, key)) {
        try {
          const linked = await fetchJiraIssue(linkedKey, baseUrl, creds, timeoutMs);
          const linkedDesc = renderedOrRaw(linked.renderedFields?.description, linked.fields.description);
          const linkedAc = renderedOrRaw(linked.renderedFields?.[acFieldKey], linked.fields[acFieldKey]);
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
        } catch (error) {
          // A linked ticket that can't be fetched (wrong host, no access,
          // deleted) is supplementary context, not required -- skip it
          // rather than failing the whole fetch.
          logError(`Linked Jira ticket ${linkedKey} could not be fetched, skipped`, error);
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
          log(`Jira attachment parsed: ${att.filename} (${kind})`);
        } catch (error) {
          logError(`Could not read Jira attachment "${att.filename}"`, error);
          this.post({
            type: 'toast',
            level: 'warn',
            message: `Could not read attachment "${att.filename}": ${toMessage(error)}`,
          });
        }
      }

      log(`Jira fetch OK: ${key} -- ${chunks.length} chunk(s) (${chunks.map((c) => c.kind).join(', ')})`);
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
      logError('Jira fetch failed', error);
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

      const relativePath = vscode.workspace.asRelativePath(fileUri, false);
      log(`Feature file saved: ${relativePath}`);
      this.post({ type: 'featureFileSaved', path: relativePath });
    } catch (error) {
      logError('Saving the feature file failed', error);
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
      log(`File attached: ${fileName} (${meta.kind})`);
      this.post({ type: 'fileAttached', meta, preview: summarizeContent(fileId, content) });
    } catch (error) {
      logError('Attaching the picked file failed', error);
      this.post({ type: 'fileAttachError', message: toMessage(error) });
    }
  }

  private async handleEstimateContext(
    message: Extract<WebviewMessage, { type: 'estimateContext' }>
  ): Promise<void> {
    try {
      const workflow = getWorkflow(message.workflowId);
      // Prefer whichever model a real send already confirmed works this
      // session (see handleSendPrompt) over the webview's default
      // selection -- the estimate path itself never retries with a
      // fallback model (it has to stay fast/side-effect-free), so without
      // this, a session whose default model doesn't respond would have
      // the Context Limit meter stall on every single keystroke pause
      // even after the user's actual messages have been auto-recovering
      // via a different model all along.
      const model = (await orderedCandidateModels(this.lastWorkingModelUid ?? message.modelUid))[0];
      const maxTokens = typeof model.maxInputTokens === 'number' ? model.maxInputTokens : null;

      const attachedFile = message.attachedFileId
        ? this.buildAttachedFilePayload(message.attachedFileId)
        : null;
      const jiraChunks = message.jiraChunkIds ? this.jiraContext.contentFor(message.jiraChunkIds) : undefined;
      // Build/refresh the BM25 index for every selected KB as soon as the
      // selection is known -- this call fires the instant a KB checkbox is
      // ticked (before any text is typed, since retrieve() below is a
      // no-op on an empty query), so the one-time chunk/tokenize/index
      // cost for a newly-selected KB (potentially a large
      // Confluence-imported one) is paid here, off the path the user
      // actually waits on, instead of silently inside their first real
      // question.
      const kbScope = this.effectiveKnowledgeBaseIds(workflow.id, message.selectedKnowledgeBaseIds);
      warmIndexes(this.knowledgeBases, kbScope);
      const retrievedChunks = this.retrieveForRequest(kbScope, message.userText);

      const { content, summary, promptTokens: computedPromptTokens } = await buildContext({
        workflow,
        userText: message.userText,
        selectedSkills: message.selectedSkills,
        selectedInstructions: message.selectedInstructions,
        selectedPromptFile: message.selectedPromptFile,
        attachedFile,
        jiraChunks,
        retrievedChunks,
        modelMaxInputTokens: maxTokens,
        countTokens: (text) => countTokens(model, vscode.LanguageModelChatMessage.User(text)),
      });

      // `computedPromptTokens` is legitimately null both when the model
      // doesn't report maxInputTokens (buildContext's refinement pass
      // never runs -- normal) and when the model call genuinely
      // stalled/failed (contextBuilder's both-null guard -- see above).
      // One fallback measurement distinguishes them: if THIS also comes
      // back fully unmeasured, it's a real stall, not just a skipped
      // refinement pass.
      let promptTokens = computedPromptTokens;
      if (promptTokens === null) {
        const [systemTokens, contentTokens] = await Promise.all([
          countTokens(model, vscode.LanguageModelChatMessage.User(workflow.systemPrompt)),
          countTokens(model, vscode.LanguageModelChatMessage.User(content)),
        ]);
        if (systemTokens === null && contentTokens === null) {
          // Genuinely couldn't measure -- reporting this as a confident
          // 0% would be actively misleading (as if there's nothing to
          // send), so leave the meter at whatever it last showed instead,
          // exactly like the catch block below does for every other
          // failure in this method.
          log('Context estimation: token count unavailable (model call did not respond), meter left unchanged');
          return;
        }
        promptTokens = (systemTokens ?? 0) + (contentTokens ?? 0);
      }

      const usedTokens = promptTokens;
      const exceeded = maxTokens !== null && usedTokens > maxTokens;

      this.post({
        type: 'contextMeter',
        usedTokens,
        maxTokens,
        exceeded,
        lastLineIncluded: exceeded ? summary.attachedFileLastLine : null,
      });
    } catch (error) {
      // Context estimation is advisory-only UI feedback -- a failure here
      // (e.g. no model selected yet, or a stalled vscode.lm call -- see
      // withLmTimeout in copilotClient.ts) should never surface as an
      // error toast. It must still be logged, though: silently swallowing
      // this previously meant the Context Limit meter could get stuck at
      // 0 with literally no trace of why anywhere -- not even in the
      // Output channel -- making a real bug here undiagnosable.
      logError('Context estimation failed (advisory only, not shown to user)', error);
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
      // Every candidate model in try order (the requested one first) --
      // context is assembled once against candidates[0]'s budget below;
      // if that specific model then turns out not to respond,
      // sendChatWithFallback retries with the next one using the SAME
      // assembled content, automatically, instead of leaving the request
      // hanging until the user notices and switches models by hand.
      const candidates = await orderedCandidateModels(message.modelUid);
      const model = candidates[0];
      log(`sendPrompt: workflow=${workflow.id} model=${message.modelUid} requestId=${requestId}`);
      const attachedFile = message.attachedFileId
        ? this.buildAttachedFilePayload(message.attachedFileId)
        : null;
      const jiraChunks = message.jiraChunkIds ? this.jiraContext.contentFor(message.jiraChunkIds) : undefined;
      // RAG: retrieve against the user's actual question. Runs for EVERY
      // workflow (including generic chat) because this is the single
      // shared send path. General Chat and Knowledge Base Q&A additionally
      // default to searching EVERY knowledge base the user has (bundled +
      // workspace + personal) when none is explicitly ticked -- see
      // effectiveKnowledgeBaseIds() -- so asking a question doesn't
      // silently retrieve nothing just because the user forgot to select
      // one first. An explicit selection still narrows the scope.
      const kbScope = this.effectiveKnowledgeBaseIds(workflow.id, message.selectedKnowledgeBaseIds);
      const retrievedChunks = this.retrieveForRequest(kbScope, message.userText);
      if (retrievedChunks) {
        log(`RAG: retrieved ${retrievedChunks.length} chunk(s) from ${kbScope.length} knowledge base(s) (workflow=${workflow.id})`);
      }

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
        retrievedChunks,
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
      // promptTokens is counted against candidates[0]'s tokenizer, before
      // it's known whether that specific model will actually respond --
      // recomputing it a second time against whichever model ends up
      // responding (only when a fallback happened) would mean re-running
      // buildContext's budgeting too, adding real latency to guard an
      // edge case. The reported count can be a close-but-not-exact
      // approximation on the rare request that needed a fallback; every
      // other figure (completion tokens, the model name recorded in
      // history) below reflects the model that actually responded.
      this.post({ type: 'promptTokenCounted', requestId, promptTokens });

      this.post({ type: 'streamStart', requestId });

      const {
        text: responseText,
        model: respondingModel,
        switched,
      } = await sendChatWithFallback(candidates, workflow.systemPrompt, content, {
        token: cts.token,
        onChunk: (text) => this.post({ type: 'streamChunk', requestId, text }),
      });

      // A real response just confirmed which model actually works this
      // session -- reuse it for every context-estimate call from now on
      // (see handleEstimateContext) instead of repeatedly stalling
      // against a default model already known not to respond.
      this.lastWorkingModelUid = getModelUid(respondingModel);
      if (switched) {
        log(
          `sendPrompt: model "${message.modelUid}" did not respond -- automatically switched to "${this.lastWorkingModelUid}" (${respondingModel.name}) requestId=${requestId}`
        );
        this.post({
          type: 'modelAutoSwitched',
          modelUid: this.lastWorkingModelUid,
          modelName: respondingModel.name || respondingModel.id || this.lastWorkingModelUid,
          fromModelUid: message.modelUid,
        });
      }

      const completionTokens = (await countTokens(respondingModel, responseText, cts.token)) ?? 0;
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
        modelName: respondingModel.name || respondingModel.id || 'unknown',
        usage,
      });
      await this.tokenHistory.flush();

      log(
        `sendPrompt OK: requestId=${requestId} promptTokens=${usage.promptTokens} completionTokens=${usage.completionTokens} charsSent=${summary.approxCharsSent}`
      );
      this.post({
        type: 'streamDone',
        requestId,
        contextSummary: { ...summary, modelName: respondingModel.name || respondingModel.id || 'unknown' },
        usage,
        session: this.sessionTotals,
      });
    } catch (error) {
      logError(`sendPrompt failed: requestId=${requestId}`, error);
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
