// Vanilla JS webview app -- no framework, no build step for this file, so
// it loads instantly inside the sidebar with zero bundling/runtime lag.
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {any} */
  const state = {
    workflows: [],
    workflowId: null,
    wizards: [],
    models: [],
    modelUid: null,
    skills: [],
    instructions: [],
    prompts: [],
    selectedSkills: new Set(),
    selectedInstructions: new Set(),
    selectedPromptFile: null,
    promptFileContent: '',
    promptFileDirty: false,
    userText: '',
    streaming: false,
    // One entry per exchange -- a request/response *pair* -- rendered as a
    // two-sided chat thread (request bubble right-aligned, response
    // bubble left-aligned), like a real messaging app. Accumulates across
    // the whole session (persists until the view or VS Code closes),
    // never replaced on a new send.
    // Shape: { id, timestamp, workflowLabel, requestText, responseText,
    //          streaming, error, contextSummary }
    chatEntries: [],
    settingsOpen: false,
    wizard: null, // { kind, stepIndex, data }
    testConnBusy: false,
    testConnResult: null,
    testConnUsage: null,
    requestId: null,
    lastUsage: null, // { promptTokens, completionTokens, totalTokens }
    pendingPromptTokens: null, // set once counted, before the response finishes streaming
    tokenSession: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    historyOpen: false,
    historyEntries: null, // null = not loaded yet
    historyConfirmClear: false,
    // Explicit, state-driven collapse tracking (NOT DOM classList toggling):
    // several actions (checkbox toggles, streaming chunks, etc.) call
    // renderBody(), which rebuilds .body's innerHTML from scratch. A card's
    // open/closed state has to live here, or it gets silently reset to
    // "expanded" on every re-render. All segments start collapsed for a
    // clean landing view.
    collapsed: {
      chat: true,
      tokenUsage: true,
      // Settings overlay sections. Namespaced with a "settings" prefix so
      // they can never collide with a main-body card id, even though the
      // two collapse systems already share one flat `state.collapsed` map.
      settingsSkills: true,
      settingsInstructions: true,
      settingsPrompts: true,
      settingsConnection: true,
      settingsAuthor: true,
      // PROD Incident Analysis's MAL Codes / date-range / Fetch form --
      // collapsed by default so it doesn't dominate the compose area once
      // incidents are already loaded; the result summary + jump links stay
      // visible regardless of this state (see incidentSearchPanelHtml).
      incidentSearchForm: true,
    },
    promptEditorExpanded: false,
    historyFilters: { workflow: '', model: '', host: '', dateFrom: '', dateTo: '', search: '' },
    // ---- File attach ----
    fileParsing: false,
    attachedFile: null, // { meta, preview } once a file has been picked and parsed
    controlPanelOpen: false,
    fileSelectionDraft: {}, // working copy of FileSelection edited in the Control panel, applied on "Apply Selection"
    contextMeter: null, // { usedTokens, maxTokens, exceeded, lastLineIncluded }
    // ---- PROD Incident Analysis (ServiceNow) ----
    incidentSearch: { malCodes: '', dateFrom: '', dateTo: '', busy: false, summary: null }, // summary: { count, query } once fetched
    // Tracks exactly which Skill/Instruction/Prompt the *active workflow*
    // auto-selected (see applyWorkflowSwitch), so switching workflows can
    // cleanly remove only those on the way out -- never a selection the
    // user picked manually themselves.
    autoSelection: { skill: null, instruction: null, prompt: null },
    // The single inline content viewer/editor shared by Skills and
    // Instructions (Custom Prompts keep their own dedicated
    // selectedPromptFile/promptFileContent/promptFileDirty state below,
    // since selecting a prompt already doubles as opening it for editing).
    // Shape: { kind: 'skill'|'instruction', file, content, dirty, expanded }
    managedFileEditor: null,
    // ---- Generate Feature File From Jira Story ----
    // The whole site/username/password/ticket-url/save-path collection
    // happens as a conversation inside the chat itself (bot bubbles the
    // user answers by clicking or typing in the normal compose box) --
    // see createEmptyJiraWizard()/startJiraWizard() for the step machine.
    jiraWizard: createEmptyJiraWizard(),
  };

  let contextEstimateTimer = null;

  function uid() {
    return 'req-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  // ---------------- Toasts ----------------
  function toast(level, message) {
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast ' + level;
    el.textContent = message;
    stack.appendChild(el);
    // Errors and warnings linger longer -- a failure or a "this file has
    // no real content" warning is worth more than a glance, whereas info
    // toasts can clear quickly.
    setTimeout(() => el.remove(), level === 'error' || level === 'warn' ? 12000 : 4500);
  }

  // ---------------- Root render ----------------
  function renderRoot() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="header">
        <div>
          <h1>ARSIM TDS QE GHCP Interface</h1>
          <div class="subtitle">Enterprise QE workflows over GitHub Copilot</div>
        </div>
        <button class="icon-btn" id="settings-btn" title="Settings" aria-label="Settings">${gearIcon()}</button>
      </div>
      <div class="body" id="body"></div>
      <div class="token-footer" id="token-footer"></div>
      <div class="overlay" id="settings-overlay"></div>
      <div class="overlay" id="wizard-overlay"></div>
      <div class="overlay" id="history-overlay"></div>
      <div class="overlay" id="control-overlay"></div>
      <div class="toast-stack" id="toast-stack"></div>
    `;
    document.getElementById('settings-btn').addEventListener('click', () => {
      state.settingsOpen = true;
      renderSettings();
    });
    renderBody();
    renderTokenFooter();
  }

  // ---------------- Token usage footer ----------------
  function fmtTok(n) {
    return n === null || n === undefined ? '—' : n.toLocaleString();
  }

  function renderTokenFooter() {
    const el = document.getElementById('token-footer');
    if (!el) return;

    const last = state.lastUsage;
    const pending = !last && state.pendingPromptTokens !== null;
    const lastLine = last
      ? `<span class="tok-up">↑ ${fmtTok(last.promptTokens)}</span> · <span class="tok-down">↓ ${fmtTok(last.completionTokens)}</span> · <span class="tok-total">Σ ${fmtTok(last.totalTokens)}</span>`
      : pending
      ? `<span class="tok-up">↑ ${fmtTok(state.pendingPromptTokens)}</span> · <span class="tok-down">↓ awaiting response…</span>`
      : '<span>—</span>';

    const s = state.tokenSession;
    const sessionLine = `<span class="tok-up">↑ ${fmtTok(s.promptTokens)}</span> · <span class="tok-down">↓ ${fmtTok(s.completionTokens)}</span> · <span class="tok-total">Σ ${fmtTok(s.totalTokens)}</span>`;

    const collapsedClass = state.collapsed.tokenUsage ? ' collapsed' : '';
    el.className = 'token-footer' + collapsedClass;
    el.innerHTML = `
      <div class="token-footer-row" data-toggle="tokenUsage">
        <span class="token-footer-title">${tokenIcon()} Token Usage</span>
        <span class="chevron">${chevronIcon()}</span>
      </div>
      <div id="context-meter-container" class="token-footer-meter">${contextMeterHtml()}</div>
      <div class="token-footer-body">
        <div class="token-footer-links">
          <button class="link-btn" id="token-history-btn">Token Usage History</button>
          <span class="token-footer-sep">·</span>
          <button class="link-btn" id="token-reset-btn" title="Reset cumulative session totals">Reset session</button>
        </div>
        <div class="token-stats">
          <div class="token-stat"><span class="token-label">Last request</span><span class="token-value">${lastLine}</span></div>
          <div class="token-stat"><span class="token-label">Session (${s.requestCount} request${s.requestCount === 1 ? '' : 's'})</span><span class="token-value">${sessionLine}</span></div>
        </div>
      </div>
    `;

    wireToggles(el, renderTokenFooter);
    wireControlContextLinks(el);
    document.getElementById('token-reset-btn').addEventListener('click', () => {
      post({ type: 'resetTokenSession' });
    });
    document.getElementById('token-history-btn').addEventListener('click', openHistory);
  }

  function tokenIcon() {
    return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" style="vertical-align:-1px"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6v3.6l2.4 1.4"/></svg>`;
  }

  function gearIcon() {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"/><path d="M13.2 8a5.2 5.2 0 0 0-.08-.9l1.3-1-1.2-2.1-1.53.5a5.3 5.3 0 0 0-1.55-.9L9.8 2h-3.6l-.34 1.6a5.3 5.3 0 0 0-1.55.9l-1.53-.5-1.2 2.1 1.3 1a5.3 5.3 0 0 0 0 1.8l-1.3 1 1.2 2.1 1.53-.5c.46.38.98.69 1.55.9L6.2 14h3.6l.34-1.6c.57-.21 1.09-.52 1.55-.9l1.53.5 1.2-2.1-1.3-1c.05-.3.08-.6.08-.9Z"/></svg>`;
  }

  // ---------------- Main body ----------------
  /**
   * Only the Chat segment lives here now (Workflow moved into Settings).
   *
   * This replaces #body's innerHTML wholesale, which destroys and recreates
   * every DOM node inside it -- including the compose textarea if it
   * happens to be focused. Several message handlers (streamChunk's first
   * token, streamDone, streamError, file-attach events) call this while the
   * user could plausibly still have focus in #user-text, so focus/selection
   * is explicitly captured before the rebuild and restored after it by id --
   * otherwise the user's cursor silently drops out of the textarea and they
   * have to click back in to keep typing.
   */
  function renderBody() {
    const body = document.getElementById('body');
    const active = document.activeElement;
    const hadFocusId = active && body.contains(active) ? active.id : null;
    const hadSelection = hadFocusId && typeof active.selectionStart === 'number'
      ? [active.selectionStart, active.selectionEnd]
      : null;

    body.innerHTML = `
      ${cardHtml('chat', 'Chat', state.chatEntries.length, chatCardBodyHtml())}
    `;
    wireBody();

    if (hadFocusId) {
      const el = document.getElementById(hadFocusId);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (hadSelection && typeof el.setSelectionRange === 'function') {
          try { el.setSelectionRange(hadSelection[0], hadSelection[1]); } catch { /* not a text-selectable input */ }
        }
      }
    }
  }

  function cardHtml(id, title, badgeCount, innerHtml) {
    const collapsedClass = state.collapsed[id] ? ' collapsed' : '';
    return `
      <div class="card${collapsedClass}" id="card-${id}">
        <div class="card-header" data-toggle="${id}">
          <div class="card-title">${esc(title)} ${badgeCount ? `<span class="badge">${badgeCount}</span>` : ''}</div>
          <span class="chevron">${chevronIcon()}</span>
        </div>
        <div class="card-body">${innerHtml}</div>
      </div>`;
  }

  /**
   * Lighter-weight collapsible section for use *inside* an already-full-
   * screen overlay (Settings): same state-driven collapse behavior and
   * chevron as a main-body `.card`, but without its border/shadow/rounded
   * corners -- stacking five bordered "cards" inside a settings panel
   * reads as visually heavier than the flat sectioned list Settings
   * already uses elsewhere (e.g. Connection, Author Content).
   */
  function settingsSectionHtml(id, title, badgeCount, innerHtml) {
    const collapsedClass = state.collapsed[id] ? ' collapsed' : '';
    return `
      <div class="settings-section${collapsedClass}" id="settings-section-${id}">
        <div class="settings-section-header" data-toggle="${id}">
          <h3>${esc(title)} ${badgeCount ? `<span class="badge">${badgeCount}</span>` : ''}</h3>
          <span class="chevron">${chevronIcon()}</span>
        </div>
        <div class="settings-section-body">${innerHtml}</div>
      </div>`;
  }

  /**
   * Deep-links from the main Chat view into a specific, already-expanded
   * Settings section (used by the "Select Skill / Instruction / Custom
   * Prompt" links beside Browse). Opens Settings, force-expands the target
   * section regardless of its prior collapsed state, then scrolls it into
   * view once the overlay has actually rendered.
   */
  function openSettingsSection(sectionId) {
    state.settingsOpen = true;
    state.collapsed[sectionId] = false;
    renderSettings();
    requestAnimationFrame(() => {
      const el = document.getElementById('settings-section-' + sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** Shared by wireBody() and wireSettings(): flips state.collapsed[id] and
   *  re-renders via whichever render function owns that container, so the
   *  collapse mechanism has exactly one implementation regardless of which
   *  panel a collapsible section lives in. Scoped to `container` (not
   *  `document`) so wiring one panel never also binds toggles belonging to
   *  the other if both happen to be present in the DOM at once. */
  function wireToggles(container, rerender) {
    container.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-toggle');
        state.collapsed[id] = !state.collapsed[id];
        rerender();
      });
    });
  }

  function chevronIcon() {
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4"/></svg>`;
  }

  function copyIcon() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1"/></svg>`;
  }

  function formatChatTimestamp(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function scrollChatToBottom() {
    const thread = document.getElementById('chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  /** Plain-text rendering of the whole conversation, e.g. for clipboard
   *  export -- one "You: ... / Copilot: ..." block per exchange, in order. */
  function allChatAsText() {
    return state.chatEntries
      .map((e) => {
        const lines = [`[${formatChatTimestamp(e.timestamp)}] You: ${e.requestText}`];
        if (e.error) {
          lines.push(`Copilot: [error] ${e.error}`);
        } else if (e.responseText) {
          lines.push(`Copilot (${e.workflowLabel}): ${e.responseText}`);
        }
        return lines.join('\n');
      })
      .join('\n\n');
  }

  /** navigator.clipboard.writeText works in VS Code webviews (Chromium) on
   *  a user gesture; the execCommand fallback covers any restricted
   *  environment where the async Clipboard API is unavailable. */
  function copyResponseToClipboard() {
    if (!state.chatEntries.length) return;
    const text = allChatAsText();
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('info', 'Conversation copied to clipboard.');
      } catch {
        toast('error', 'Could not copy to clipboard.');
      } finally {
        ta.remove();
      }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('info', 'Response copied to clipboard.'),
        fallback
      );
    } else {
      fallback();
    }
  }

  function workflowCardBodyHtml() {
    const options = state.workflows
      .map((w) => `<option value="${esc(w.id)}" ${w.id === state.workflowId ? 'selected' : ''}>${esc(w.label)}</option>`)
      .join('');
    const active = state.workflows.find((w) => w.id === state.workflowId);

    return `
      <div class="field">
        <label class="field-label">Workflow to perform</label>
        <select id="workflow-select">${options}</select>
        ${active ? `<span class="hint">${esc(active.description)}</span>` : ''}
      </div>
    `;
  }

  /** Compact "what's currently active" status shown on the Chat view now
   *  that Workflow and Model selection both live in Settings -- without
   *  this, a user would have no way to see either without opening the
   *  overlay. Reused for the compose-area status line. */
  function workflowModelStatusHtml() {
    const active = state.workflows.find((w) => w.id === state.workflowId);
    const activeModel = state.models.find((m) => m.uid === state.modelUid);
    return `
      <div class="hint">
        Workflow: ${active ? esc(active.label) : 'none selected'} · Model: ${activeModel ? esc(activeModel.name) : 'none selected'}
        <button class="link-btn" id="open-settings-for-model">(change in Settings)</button>
      </div>`;
  }

  function skillsBodyHtml() {
    return fileChecklistHtml(state.skills, state.selectedSkills, 'skill', 'No skill files found in .github/skills/.');
  }
  function instructionsBodyHtml() {
    return fileChecklistHtml(state.instructions, state.selectedInstructions, 'instruction', 'No instruction files found in .github/instructions/.');
  }

  /** Skills/Instructions: a checkbox (context inclusion) plus a clickable
   *  name (opens the shared inline viewer/editor below the list -- see
   *  managedFileEditorHtml) for each file. Checking a box and opening a
   *  file to view/edit it are independent actions. */
  function fileChecklistHtml(files, selectedSet, kind, emptyText) {
    if (!files.length) {
      return `<div class="empty-hint">${esc(emptyText)}</div>`;
    }
    const rows = files
      .map(
        (f) => `
        <label class="check-row">
          <input type="checkbox" data-kind="${kind}" data-path="${esc(f.relativePath)}" ${selectedSet.has(f.relativePath) ? 'checked' : ''} />
          <button type="button" class="check-row-name" data-open-kind="${kind}" data-open-path="${esc(f.relativePath)}" title="View / edit ${esc(f.relativePath)}">${esc(f.fileName)}</button>
        </label>`
      )
      .join('');
    return `<div class="checklist">${rows}</div>${managedFileEditorHtml(kind)}`;
  }

  /** Inline content viewer/editor shared by Skills and Instructions,
   *  generalized from the Custom Prompts editor below (same textarea +
   *  Expand/Collapse + Save shape) so clicking any skill or instruction
   *  name -- including the ones a workflow auto-selects, per PROD Incident
   *  Analysis -- lets the user actually read and edit it, not just toggle
   *  a checkbox. */
  function managedFileEditorHtml(kind) {
    const ed = state.managedFileEditor;
    if (!ed || ed.kind !== kind) return '';
    return `
      <div class="field">
        <div class="field-label-row">
          <label class="field-label">${esc(ed.file.fileName)} ${ed.dirty ? '(unsaved changes)' : ''}</label>
          <button class="link-btn" id="managed-file-expand-btn">${ed.expanded ? 'Collapse ↑' : 'Expand ↓'}</button>
        </div>
        <textarea id="managed-file-editor" class="${ed.expanded ? 'expanded' : ''}" style="min-height:120px;">${esc(ed.content)}</textarea>
      </div>
      <div class="btn-row">
        <button class="btn" id="managed-file-save-btn">Save</button>
        <button class="link-btn" id="managed-file-close-btn">Close</button>
      </div>`;
  }

  function openManagedFileEditor(kind, relativePath) {
    const list = kind === 'skill' ? state.skills : state.instructions;
    const file = list.find((f) => f.relativePath === relativePath);
    if (!file) return;
    state.managedFileEditor = { kind, file, content: '', dirty: false, expanded: false };
    renderSettings();
    post({ type: 'loadManagedFile', kind, file });
  }

  function promptsBodyHtml() {
    const options =
      `<option value="">— Select a prompt file —</option>` +
      state.prompts.map((p) => `<option value="${esc(p.relativePath)}" ${state.selectedPromptFile && state.selectedPromptFile.relativePath === p.relativePath ? 'selected' : ''}>${esc(p.fileName)}</option>`).join('');

    const editor = state.selectedPromptFile
      ? `
        <div class="field">
          <div class="field-label-row">
            <label class="field-label">Prompt Content ${state.promptFileDirty ? '(unsaved changes)' : ''}</label>
            <button class="link-btn" id="prompt-editor-expand-btn">${state.promptEditorExpanded ? 'Collapse ↑' : 'Expand ↓'}</button>
          </div>
          <textarea id="prompt-editor" class="${state.promptEditorExpanded ? 'expanded' : ''}" style="min-height:120px;">${esc(state.promptFileContent)}</textarea>
        </div>
        <div class="field">
          <label class="field-label">Save As File Name</label>
          <input type="text" id="prompt-save-name" value="${esc(state.selectedPromptFile.fileName)}" />
        </div>
        <div class="btn-row">
          <button class="btn" id="prompt-save-same">Save</button>
          <button class="btn secondary" id="prompt-save-new">Save As New File</button>
        </div>`
      : '';

    return `
      <div class="field">
        <label class="field-label">Prompt File</label>
        <select id="prompt-select">${options}</select>
      </div>
      ${editor}
      ${state.prompts.length === 0 ? `<div class="empty-hint">No prompt files found in .github/prompts/.</div>` : ''}
    `;
  }

  /**
   * The merged Chat segment: a two-party thread (request bubbles right-
   * aligned/grey, response bubbles left-aligned/green, Messenger-style),
   * fixed to 70% of the viewport height with its own scrollbar (see
   * "#card-chat .chat-panel" in main.css), followed by the compose bar
   * (workflow/model status, textarea + send, attach/incident-search row).
   * The Context Limit meter lives independently in the Token Usage footer
   * now, not here -- see renderTokenFooter().
   */
  function chatCardBodyHtml() {
    const hasEntries = state.chatEntries.length > 0;
    const threadClasses = 'response-panel chat-panel' + (hasEntries ? '' : ' empty-thread');
    return `
      <div class="field-label-row chat-toolbar">
        <span class="hint">${hasEntries ? `${state.chatEntries.length} exchange${state.chatEntries.length === 1 ? '' : 's'} this session` : 'No messages yet'}</span>
        <button class="icon-btn small" id="copy-response-btn" title="Copy full conversation" aria-label="Copy conversation" ${hasEntries ? '' : 'disabled'}>${copyIcon()}</button>
      </div>
      <div class="${threadClasses}" id="chat-thread">${jiraWizardLogHtml()}${chatThreadHtml()}${suggestedChipsHtml()}</div>
      <div class="field compose-field">
        ${workflowModelStatusHtml()}
        <div class="compose-input-row">
          ${composeInputHtml()}
          <button class="icon-btn send-icon-btn" id="send-btn" title="Send" aria-label="Send to Copilot" ${state.streaming || isJiraComposeBusy() ? 'disabled' : ''}>${state.streaming ? spinnerIcon() : sendIcon()}</button>
        </div>
        <div class="hint">Press Enter to send · Shift+Enter for a new line</div>
        ${isJiraWorkflow() ? jiraContextRowHtml() : isIncidentWorkflow() ? incidentSearchPanelHtml() : attachedFileRowHtml()}
      </div>
    `;
  }

  function sendIcon() {
    return `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M2.5 13.5l11-5.5-11-5.5v4.3l6.5 1.2-6.5 1.2v4.3z"/></svg>`;
  }

  function spinnerIcon() {
    return `<svg class="spinner" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" /></svg>`;
  }

  /**
   * PROD Incident Analysis's own compose-area panel, shown in place of the
   * generic Browse row (one attachment slot, one workflow-appropriate
   * input surface -- fetched incidents occupy the same slot a real
   * uploaded file would). MAL codes + date range are the parameterized
   * pieces of the fixed ServiceNow query; "Review / select tickets" and
   * "New incident search" only appear once a fetch has completed.
   */
  function incidentSearchPanelHtml() {
    const s = state.incidentSearch;
    const hasResult = !!s.summary;
    const formFieldsHtml = `
      <div class="field">
        <label class="field-label">MAL Codes (comma-separated)</label>
        <input type="text" id="incident-mal-codes" value="${esc(s.malCodes)}" placeholder="e.g. INNPE, DDR" ${s.busy ? 'disabled' : ''} />
      </div>
      <div class="range-row">
        <div class="field">
          <label class="field-label">From date</label>
          <input type="date" id="incident-date-from" value="${esc(s.dateFrom)}" ${s.busy ? 'disabled' : ''} />
        </div>
        <div class="field">
          <label class="field-label">To date</label>
          <input type="date" id="incident-date-to" value="${esc(s.dateTo)}" ${s.busy ? 'disabled' : ''} />
        </div>
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="fetch-incidents-btn" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Fetching…' : 'Fetch Incidents'}</button>
      </div>
    `;

    // The search form itself collapses (default collapsed, less clutter
    // once results are already loaded); the result summary and jump links
    // below it stay visible regardless, so they're reachable without
    // reopening the form.
    return `
      ${settingsSectionHtml('incidentSearchForm', 'Incident Search (MAL Codes & Date Range)', 0, formFieldsHtml)}
      <div class="btn-row">
        ${hasResult ? `<button class="link-btn" id="incident-control-link">Review / select tickets</button>` : ''}
        ${hasResult ? `<button class="link-btn" id="incident-new-search-btn">🔎 New incident search</button>` : ''}
        ${contextPickerLinksHtml()}
      </div>
      ${hasResult ? `<div class="hint">${s.summary.count} incident${s.summary.count === 1 ? '' : 's'} found for this MAL code / date range.</div>` : ''}
    `;
  }

  /** The three "jump into Settings" links shown beside Browse -- selecting
   *  is still done in Settings (checkboxes / select), these just navigate
   *  the user there. Whatever gets selected is picked up automatically:
   *  onSend() and scheduleContextEstimate() both read state.selectedSkills /
   *  state.selectedInstructions / state.selectedPromptFile live at call
   *  time, so a selection made mid-conversation is included in the very
   *  next request with no extra wiring needed here. */
  function contextPickerLinksHtml() {
    return `
      <button class="link-btn" id="select-skill-link">Select Skill</button>
      <button class="link-btn" id="select-instruction-link">Select Instruction</button>
      <button class="link-btn" id="select-prompt-link">Select Custom Prompt</button>
    `;
  }

  /** One `.chat-entry` per exchange: the user's request bubble followed by
   *  Copilot's response bubble (or a pulsing typing indicator while none
   *  of its text has arrived yet, or an error note if the request failed).
   *  Streaming updates the response bubble's textContent directly (see the
   *  'streamChunk' handler) rather than going through a full re-render, so
   *  typing speed never depends on thread length -- this function only
   *  runs on send, on the first chunk of a reply, and on completion/error. */
  function chatThreadHtml() {
    if (!state.chatEntries.length) return '';
    return state.chatEntries.map(chatEntryHtml).join('');
  }

  function chatEntryHtml(entry) {
    const requestBlock = `
      <div class="chat-message outgoing">
        <div class="chat-timestamp">${esc(formatChatTimestamp(entry.timestamp))}</div>
        <div class="chat-bubble outgoing">${esc(entry.requestText)}</div>
      </div>`;

    let responseBlock;
    if (entry.error && !entry.responseText) {
      // Failed before any content arrived: nothing to preserve, show the error alone.
      responseBlock = `
        <div class="chat-message incoming">
          <div class="chat-timestamp">${esc(entry.workflowLabel)}</div>
          <div class="chat-bubble incoming error">⚠ ${esc(entry.error)}</div>
        </div>`;
    } else if (!entry.responseText) {
      responseBlock = `
        <div class="chat-message incoming">
          <div class="chat-bubble incoming typing-bubble" role="status" aria-label="Copilot is responding">
            <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
          </div>
        </div>`;
    } else {
      // Has content, whether or not it also errored partway through -- a
      // stream that dies mid-response should never make the tokens already
      // received disappear. If it did fail, say so *alongside* the partial
      // text rather than instead of it.
      // The markdown table (and its CSV download) is only parsed out once
      // the response has fully finished streaming -- while chunks are
      // still arriving, this function isn't even re-run per token (see
      // 'streamChunk'), so there's nothing to parse yet anyway.
      const table = !entry.streaming ? parseMarkdownTable(entry.responseText) : null;
      // When a table was found, show ONLY the rendered <table> plus
      // whatever surrounding prose remains -- never the raw "| a | b |"
      // source text too. Showing both was redundant and, at a few hundred
      // incident rows, made the bubble unreadably long and badly formatted.
      const proseText = table ? stripTableSource(entry.responseText, table) : entry.responseText;
      // Gherkin/BDD .feature output (Generate Feature File From Jira
      // Story) reads far better in a monospace code block than the
      // proportional-font bubble everything else uses -- readability
      // polish only, the raw text isn't touched.
      const isGherkin = !table && !entry.streaming && /^\s*Feature:/m.test(proseText);
      const bubbleHtml = proseText
        ? `<div class="chat-bubble incoming" id="response-bubble-${esc(entry.id)}">${
            isGherkin ? `<pre class="code-block">${esc(proseText)}</pre>` : esc(proseText)
          }</div>`
        : '';
      const tableBlock = table
        ? `${tableToHtml(table)}<div class="btn-row"><button class="link-btn" data-download-csv="${esc(entry.id)}">⬇ Download as CSV</button></div>`
        : '';
      responseBlock = `
        <div class="chat-message incoming">
          <div class="chat-timestamp">${esc(formatChatTimestamp(entry.timestamp))} · ${esc(entry.workflowLabel)}</div>
          ${bubbleHtml}
          ${tableBlock}
          ${entry.error ? `<div class="chat-error-note">⚠ Interrupted: ${esc(entry.error)}</div>` : ''}
          ${entry.contextSummary ? contextSummaryHtml(entry.contextSummary) : ''}
        </div>`;
    }

    return `<div class="chat-entry">${requestBlock}${responseBlock}</div>`;
  }

  function attachedFileRowHtml() {
    if (state.fileParsing) {
      return `
        <div class="attached-file-row">
          <span class="hint">Parsing file… large files can take a while (up to a few hundred MB are supported).</span>
        </div>
        <div class="btn-row"><button class="btn secondary" disabled>Browse…</button></div>`;
    }

    if (!state.attachedFile) {
      return `<div class="btn-row"><button class="btn secondary" id="browse-btn">Browse…</button>${contextPickerLinksHtml()}</div>`;
    }

    const { meta, preview } = state.attachedFile;
    const warningHtml = meta.warning
      ? `<div class="attached-file-warning">⚠ ${esc(meta.warning)}</div>`
      : '';
    return `
      <div class="attached-file-row">
        <span class="attached-file-name" title="${esc(meta.fileName)}">📎 ${esc(meta.fileName)}</span>
        <span class="hint">${esc(attachedFileSummaryText(meta, preview))}</span>
        ${warningHtml}
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="browse-btn">Replace File…</button>
        ${contextPickerLinksHtml()}
        <button class="link-btn" id="control-context-link">Control the data sent in the context</button>
        <button class="link-btn" id="remove-attached-file-btn">Remove</button>
      </div>`;
  }

  function attachedFileSummaryText(meta, preview) {
    const bits = [];
    if (meta.kind === 'pdf') bits.push(`PDF · ${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'}`);
    else if (meta.kind === 'docx') bits.push(`DOCX · ~${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'} (approx.)`);
    else if (meta.kind === 'csv') bits.push(`CSV · ${meta.csvTotalRows} row${meta.csvTotalRows === 1 ? '' : 's'} · ${meta.csvColumns.length} column${meta.csvColumns.length === 1 ? '' : 's'}`);
    else if (meta.kind === 'xlsx') bits.push(`Excel · ${meta.sheets.length} sheet${meta.sheets.length === 1 ? '' : 's'}: ${meta.sheets.map((s) => s.name).join(', ')}`);
    else bits.push(`Text · ${meta.totalLines} line${meta.totalLines === 1 ? '' : 's'}`);
    bits.push(`sending ~${preview.charCount.toLocaleString()} chars`);
    return bits.join(' · ');
  }

  function contextMeterHtml() {
    const m = state.contextMeter;
    if (!m || m.maxTokens === null) return '';
    const ratio = Math.min(1, m.usedTokens / m.maxTokens);
    const pct = Math.round(ratio * 100);
    const level = m.exceeded ? 'red' : ratio >= 0.7 ? 'amber' : 'green';
    const exceededNote = m.exceeded
      ? `<div class="context-meter-warning">
          Context limit exceeded (${m.usedTokens.toLocaleString()} / ${m.maxTokens.toLocaleString()} tokens).
          ${m.lastLineIncluded !== null ? `Last line of attached-file data included: <code>${esc(truncateForDisplay(m.lastLineIncluded))}</code>` : ''}
          ${state.attachedFile ? `<button class="link-btn" id="control-context-link-warning">Control the data sent in the context</button>` : ''}
        </div>`
      : '';
    return `
      <div class="field context-meter-field">
        <div class="field-label-row">
          <label class="field-label">Context Limit</label>
          <span class="hint">${m.usedTokens.toLocaleString()} / ${m.maxTokens.toLocaleString()} tokens (${pct}%)</span>
        </div>
        <div class="context-meter-bar"><div class="context-meter-fill ${level}" style="width:${Math.min(100, pct)}%"></div></div>
        ${exceededNote}
      </div>`;
  }

  /** Classifies a Severity/Priority cell's text into the four display
   *  levels used everywhere in this workflow (ticket-selection table,
   *  chat response tables): Critical/Sev1 -> red, High/Sev2 -> amber,
   *  Medium/Sev3 -> yellow, Low/Sev4/Minor -> green. Keyword-first so an
   *  unrelated digit elsewhere in a longer cell can't false-positive. */
  function severityClass(text) {
    const t = String(text || '').trim().toLowerCase();
    if (/critical|sev\s*-?\s*1\b|^1\b|\bp1\b/.test(t)) return 'sev-red';
    if (/\bhigh\b|sev\s*-?\s*2\b|^2\b|\bp2\b/.test(t)) return 'sev-amber';
    if (/medium|moderate|sev\s*-?\s*3\b|^3\b|\bp3\b/.test(t)) return 'sev-yellow';
    if (/\blow\b|minor|sev\s*-?\s*4\b|^4\b|\bp4\b/.test(t)) return 'sev-green';
    return 'sev-neutral';
  }

  /** Narrow markdown-table detector/parser (not a full markdown renderer):
   *  finds the first "| header |" line followed by a "|---|---|" separator
   *  line, then consumes consecutive "| cell |" rows. Good enough for the
   *  LLM's own output contract (PROD Incident Analysis's system prompt
   *  requires this exact shape for multi-incident answers) without pulling
   *  in a markdown library for one narrow use. */
  function splitTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function parseMarkdownTable(text) {
    if (!text) return null;
    const lines = text.split('\n');
    const sepPattern = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;
    for (let i = 0; i < lines.length - 1; i++) {
      const headerLine = lines[i].trim();
      const sepLine = lines[i + 1].trim();
      if (!/^\|.*\|$/.test(headerLine) || !sepPattern.test(sepLine)) continue;

      const headers = splitTableRow(headerLine);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\|.*\|$/.test(lines[j].trim())) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      if (rows.length === 0) continue;
      // startLine/endLine let the caller strip the raw "| a | b |" source
      // lines back out of the surrounding prose once the table has been
      // parsed into real data -- showing both the pipe-delimited source
      // *and* the rendered table would be redundant and, at a few hundred
      // incident rows, unreadably long.
      return { headers, rows, startLine: i, endLine: j };
    }
    return null;
  }

  /** Removes a parsed table's source lines from the raw response text,
   *  leaving only whatever prose came before/after it (e.g. a lead-in
   *  sentence and the "Key Observations" paragraph the system prompt asks
   *  for) -- that prose renders in the chat bubble, the table renders
   *  separately as a real <table> via tableToHtml(). */
  function stripTableSource(text, table) {
    const lines = text.split('\n');
    const before = lines.slice(0, table.startLine).join('\n').trim();
    const after = lines.slice(table.endLine).join('\n').trim();
    return [before, after].filter(Boolean).join('\n\n');
  }

  function tableToHtml(table) {
    const sevIdx = table.headers.findIndex((h) => /severity|priority/i.test(h));
    const headHtml = table.headers.map((h) => `<th>${esc(h)}</th>`).join('');
    const bodyHtml = table.rows
      .map((row) => {
        const cellsHtml = row
          .map((cell, idx) =>
            idx === sevIdx && cell
              ? `<td><span class="severity-badge ${severityClass(cell)}">${esc(cell)}</span></td>`
              : `<td>${esc(cell)}</td>`
          )
          .join('');
        return `<tr>${cellsHtml}</tr>`;
      })
      .join('');
    return `<div class="history-table-wrap chat-inline"><table class="history-table incident-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  }

  const INCIDENT_SUGGESTED_QUESTIONS = [
    'Which of these incidents are due to OE teams (a testing miss in lower environments / Non-Prod)?',
    'Which incidents are due to a technical or configuration issue rather than a functional defect?',
    'Summarize any recurring root-cause patterns across these incidents.',
    'Show only the Sev1/Sev2 (Critical/High) incidents from this set.',
  ];

  /** Curated quick-reply pills (item: "recommend the user ask these
   *  questions"), shown under the latest response once it has finished
   *  streaming and an incident set is loaded -- clicking one sends it
   *  immediately, same as tapping a suggested reply in a messaging app. */
  function suggestedChipsHtml() {
    if (!isIncidentWorkflow() || !state.attachedFile) return '';
    const last = state.chatEntries[state.chatEntries.length - 1];
    if (!last || last.streaming || !last.responseText) return '';
    const chips = INCIDENT_SUGGESTED_QUESTIONS.map(
      (q, i) => `<button class="suggestion-chip" data-suggested-question="${i}">${esc(q)}</button>`
    ).join('');
    return `<div class="suggestion-chips">${chips}</div>`;
  }

  function truncateForDisplay(line) {
    const s = String(line || '').trim();
    return s.length > 160 ? s.slice(0, 160) + '…' : s || '(blank line)';
  }

  function contextSummaryHtml(s) {
    const parts = [
      `Model: ${esc(s.modelName)}`,
      `Workflow: ${esc(s.workflowLabel)}`,
      `Skills included: ${s.skillsIncluded}`,
      `Instructions included: ${s.instructionsIncluded}`,
      `Prompt file used: ${s.usedPromptFile ? 'yes' : 'no'}`,
      `Attached file: ${s.attachedFileName ? esc(s.attachedFileName) : 'none'}`,
      `Context sent: ~${s.approxCharsSent.toLocaleString()} chars`,
      `Budget: ${s.budgetSource === 'model' ? 'model-scaled' : 'config default'} (~${s.effectiveMaxTotalChars.toLocaleString()} char ceiling)`,
    ];
    const trunc = s.truncatedFiles && s.truncatedFiles.length
      ? `<br/>Truncated: ${s.truncatedFiles.map(esc).join('; ')}`
      : '';
    const lastLine = s.attachedFileLastLine !== null && s.attachedFileLastLine !== undefined
      ? `<br/>Last line of attached-file data included: <code>${esc(truncateForDisplay(s.attachedFileLastLine))}</code>`
      : '';
    return `<div class="context-summary">${parts.join(' · ')}${trunc}${lastLine}</div>`;
  }

  function placeholderForWorkflow() {
    if (isJiraWorkflow()) {
      switch (state.jiraWizard.step) {
        case 'username':
          return 'Enter your Jira username...';
        case 'ticketUrl':
          return 'Enter the Jira ticket URL or key (e.g. PROJ-123)...';
        case 'savePath':
          return 'Relative folder path to save the .feature file (blank = workspace root)...';
        case 'ready':
        case 'done':
          return 'Ask a follow-up question about this story, or use the buttons above...';
        default:
          return 'Follow the prompts above in the chat...';
      }
    }
    const w = state.workflows.find((x) => x.id === state.workflowId);
    return w ? w.inputPlaceholder : 'Describe your request...';
  }

  function isIncidentWorkflow() {
    const w = state.workflows.find((x) => x.id === state.workflowId);
    return !!w && w.dataSource === 'servicenow-incidents';
  }

  function isJiraWorkflow() {
    const w = state.workflows.find((x) => x.id === state.workflowId);
    return !!w && w.dataSource === 'jira-issue';
  }

  /** Adds the active workflow's auto-Skill/Instruction/Prompt (if any and
   *  not already selected) and records what was auto-added in
   *  state.autoSelection, so a later workflow switch can remove exactly
   *  that -- never a selection the user made themselves. Called both right
   *  after a workflow switch and whenever the file lists arrive (covers
   *  the extension's initial default workflow already being this one). */
  function ensureAutoSelectionForCurrentWorkflow() {
    const workflow = state.workflows.find((w) => w.id === state.workflowId);
    if (!workflow) return;

    if (workflow.autoSkillPath && !state.autoSelection.skill) {
      const skill = state.skills.find((s) => s.relativePath === workflow.autoSkillPath);
      if (skill) {
        state.selectedSkills.add(skill.relativePath);
        state.autoSelection.skill = skill.relativePath;
      }
    }
    if (workflow.autoInstructionPath && !state.autoSelection.instruction) {
      const instruction = state.instructions.find((i) => i.relativePath === workflow.autoInstructionPath);
      if (instruction) {
        state.selectedInstructions.add(instruction.relativePath);
        state.autoSelection.instruction = instruction.relativePath;
      }
    }
    if (workflow.autoPromptPath && !state.autoSelection.prompt && !state.selectedPromptFile) {
      const prompt = state.prompts.find((p) => p.relativePath === workflow.autoPromptPath);
      if (prompt) {
        state.selectedPromptFile = prompt;
        state.promptFileDirty = false;
        state.autoSelection.prompt = prompt.relativePath;
        post({ type: 'loadPrompt', file: prompt });
      }
    }
  }

  /**
   * Switching workflows resets the main view to a clean start: a fresh
   * chat thread, no leftover attached file/incident search, and the
   * *previous* workflow's own auto-selected Skill/Instruction/Prompt
   * removed (the user's own manual picks are left untouched -- only
   * exactly what state.autoSelection recorded as auto-added goes away).
   * The new workflow's own auto-selection is then applied.
   */
  function applyWorkflowSwitch(newWorkflowId) {
    if (state.autoSelection.skill) {
      state.selectedSkills.delete(state.autoSelection.skill);
      state.autoSelection.skill = null;
    }
    if (state.autoSelection.instruction) {
      state.selectedInstructions.delete(state.autoSelection.instruction);
      state.autoSelection.instruction = null;
    }
    if (state.autoSelection.prompt && state.selectedPromptFile && state.selectedPromptFile.relativePath === state.autoSelection.prompt) {
      state.selectedPromptFile = null;
      state.promptFileContent = '';
      state.promptFileDirty = false;
      state.autoSelection.prompt = null;
    }

    // Leaving Generate Feature File From Jira Story: the username/password
    // held in state.jiraWizard are in-memory only by design (never
    // SecretStorage, never a file) and are explicitly meant to be forgotten
    // the moment the user leaves this workflow -- not just reset to an
    // empty form.
    const leavingWorkflow = state.workflows.find((w) => w.id === state.workflowId);
    if (leavingWorkflow && leavingWorkflow.dataSource === 'jira-issue') {
      state.jiraWizard = createEmptyJiraWizard();
    }

    state.workflowId = newWorkflowId;
    state.chatEntries = [];
    state.userText = '';
    if (state.attachedFile) post({ type: 'clearAttachedFile', fileId: state.attachedFile.meta.fileId });
    state.attachedFile = null;
    state.contextMeter = null;
    state.fileSelectionDraft = {};
    state.incidentSearch = { malCodes: '', dateFrom: '', dateTo: '', busy: false, summary: null };

    ensureAutoSelectionForCurrentWorkflow();

    const enteringWorkflow = state.workflows.find((w) => w.id === newWorkflowId);
    if (enteringWorkflow && enteringWorkflow.dataSource === 'jira-issue') {
      startJiraWizard();
    }
  }

  // ---------------- Generate Feature File From Jira Story ----------------
  // The whole setup (site, username, masked password, ticket URL, and
  // later the save path) is collected as a conversation inside the chat
  // itself: a bot bubble poses each question, the user answers by clicking
  // a bubble option or typing in the normal compose box, and the answer is
  // echoed back as an outgoing bubble -- see jiraWizardLogHtml() for how
  // this renders and onSend()/handleJiraWizardAnswer() for how a typed
  // answer gets routed here instead of to the LLM.

  function createEmptyJiraWizard() {
    return {
      // idle -> chooseSite -> [username -> password ->] ticketUrl ->
      // fetching -> ready -> llmPending -> savePath -> saving -> done
      step: 'idle',
      site: null, // 'jtmf' | 'track'
      username: '',
      password: '',
      // Once true, "Analyze another ticket" skips straight past
      // username/password back to ticketUrl -- credentials are asked once
      // per workflow-active session, not once per ticket.
      hasCredentials: false,
      ticketKey: null,
      ticketSummary: null,
      chunks: [], // JiraChunkMeta[] from the host (metadata only, never content)
      selectedChunkIds: new Set(),
      attachmentSelectionDrafts: {}, // chunkId -> working FileSelection, mirrors fileSelectionDraft
      log: [], // { id, kind: 'bot-text'|'bot-options'|'user-text', text, options?, answered? }
      pendingRequestId: null, // the sendPrompt requestId this wizard is waiting on, if any
      controlPanelOpen: false,
      controlPanelChunkId: null, // set when reviewing one attachment's own range controls
    };
  }

  function pushJiraBotText(text) {
    state.jiraWizard.log.push({ id: uid(), kind: 'bot-text', text });
  }
  function pushJiraBotOptions(text, options) {
    state.jiraWizard.log.push({ id: uid(), kind: 'bot-options', text, options, answered: false });
  }
  function pushJiraUserEcho(text) {
    state.jiraWizard.log.push({ id: uid(), kind: 'user-text', text });
  }

  /** Starts (or restarts, for "Analyze another ticket") the setup
   *  conversation. Site is always asked again -- only username/password
   *  are skipped once already known, per spec. */
  function startJiraWizard() {
    state.jiraWizard.log = [];
    state.jiraWizard.chunks = [];
    state.jiraWizard.selectedChunkIds = new Set();
    state.jiraWizard.attachmentSelectionDrafts = {};
    state.jiraWizard.ticketKey = null;
    state.jiraWizard.ticketSummary = null;
    state.jiraWizard.pendingRequestId = null;
    pushJiraBotOptions('Which Jira site is this story on?', [
      { label: 'jtmf.td.com', value: 'jtmf' },
      { label: 'track.td.com', value: 'track' },
    ]);
    state.jiraWizard.step = 'chooseSite';
  }

  /** True while the compose box should be disabled because the wizard is
   *  waiting on a bubble click or host-side work, not on typed text. */
  function isJiraComposeBusy() {
    return isJiraWorkflow() && ['idle', 'chooseSite', 'fetching', 'saving'].includes(state.jiraWizard.step);
  }

  /** True for steps answered by typing in the normal compose box --
   *  onSend() routes to handleJiraWizardAnswer() instead of sendPrompt for
   *  exactly these; every other workflow's onSend() path is untouched. */
  function isJiraFreeTextStep(step) {
    return step === 'username' || step === 'password' || step === 'ticketUrl' || step === 'savePath';
  }

  function onJiraWizardOptionClick(entryId, optionIndex) {
    const entry = state.jiraWizard.log.find((e) => e.id === entryId);
    if (!entry || entry.kind !== 'bot-options' || entry.answered) return;
    const option = entry.options[optionIndex];
    entry.answered = true;
    pushJiraUserEcho(option.label);

    if (state.jiraWizard.step === 'chooseSite') {
      state.jiraWizard.site = option.value;
      if (state.jiraWizard.hasCredentials) {
        pushJiraBotText('Enter the URL (or ticket key, e.g. PROJ-123) of the Jira story to analyze.');
        state.jiraWizard.step = 'ticketUrl';
      } else {
        pushJiraBotText('Enter your Jira username.');
        state.jiraWizard.step = 'username';
      }
    } else if (state.jiraWizard.step === 'ready' && option.value === 'send') {
      sendJiraFeatureFileRequest();
    } else if (state.jiraWizard.step === 'done' && option.value === 'newSearch') {
      startJiraWizard();
    }
    renderBody();
  }

  /** Routes a typed answer for the current free-text wizard step -- called
   *  from onSend() instead of the normal sendPrompt flow. */
  function handleJiraWizardAnswer(rawText) {
    const step = state.jiraWizard.step;
    const text = rawText.trim();

    if (step !== 'savePath' && !text) {
      toast('warn', 'Enter a value before sending.');
      return;
    }

    if (step === 'username') {
      state.jiraWizard.username = text;
      pushJiraUserEcho(text);
      pushJiraBotText('Enter your Jira password (masked).');
      state.jiraWizard.step = 'password';
    } else if (step === 'password') {
      state.jiraWizard.password = text;
      state.jiraWizard.hasCredentials = true;
      // Never echo the real password or even its length -- a fixed mask.
      pushJiraUserEcho('••••••••');
      pushJiraBotText('Enter the URL (or ticket key, e.g. PROJ-123) of the Jira story to analyze.');
      state.jiraWizard.step = 'ticketUrl';
    } else if (step === 'ticketUrl') {
      pushJiraUserEcho(text);
      pushJiraBotText('Fetching ticket details…');
      state.jiraWizard.step = 'fetching';
      post({
        type: 'jiraFetchTicket',
        site: state.jiraWizard.site,
        username: state.jiraWizard.username,
        password: state.jiraWizard.password,
        ticketUrl: text,
      });
    } else if (step === 'savePath') {
      pushJiraUserEcho(text || '(workspace root)');
      const lastEntry = state.chatEntries[state.chatEntries.length - 1];
      const content = lastEntry ? lastEntry.responseText : '';
      post({
        type: 'saveFeatureFile',
        relativePath: text,
        fileNameHint: state.jiraWizard.ticketSummary || state.jiraWizard.ticketKey || 'feature',
        content,
      });
      state.jiraWizard.step = 'saving';
    }

    state.userText = '';
    renderBody();
  }

  /** Fires the real LLM request -- no free-text question needed, the
   *  "Send data to LLM" bubble click is itself the trigger, so the
   *  request text is auto-generated. Goes through the *normal* onSend()
   *  path (step is 'llmPending' by then, not one of the wizard's own
   *  free-text steps), so token counting/streaming/history all work
   *  exactly as they do for every other workflow. */
  function sendJiraFeatureFileRequest() {
    // The "Send data to LLM" bubble is already consumed (its buttons
    // removed) by the time this runs -- if sending can't actually proceed
    // (no model selected yet, or a previous request is still streaming),
    // re-post a fresh options bubble so the user has a way to retry
    // instead of the wizard silently dead-ending in 'llmPending'.
    if (state.streaming || !state.modelUid) {
      if (!state.modelUid) toast('warn', 'Select a Copilot model first, then try again.');
      pushJiraBotOptions('Ready when you are.', [
        { label: '📤 Send data to LLM for feature file generation', value: 'send' },
      ]);
      state.jiraWizard.step = 'ready';
      renderBody();
      return;
    }

    const label = state.jiraWizard.ticketSummary
      ? `${state.jiraWizard.ticketKey}: ${state.jiraWizard.ticketSummary}`
      : state.jiraWizard.ticketKey;
    state.userText = `Generate a Gherkin BDD .feature file for the Jira story ${label}.`;
    state.jiraWizard.step = 'llmPending';
    onSend();
    state.jiraWizard.pendingRequestId = state.requestId;
  }

  /** The setup conversation, rendered with the exact same chat-bubble
   *  markup as everything else (zero new bubble CSS needed) -- shown above
   *  the permanent chatEntries thread. Resets each "round" (see
   *  startJiraWizard) rather than accumulating forever; completed feature-
   *  file generations stay in chatEntries permanently like any other
   *  exchange. */
  function jiraWizardLogHtml() {
    if (!isJiraWorkflow() || state.jiraWizard.log.length === 0) return '';
    return state.jiraWizard.log.map(jiraLogEntryHtml).join('');
  }

  function jiraLogEntryHtml(entry) {
    if (entry.kind === 'user-text') {
      return `
        <div class="chat-message outgoing">
          <div class="chat-bubble outgoing">${esc(entry.text)}</div>
        </div>`;
    }
    const optionsHtml =
      entry.kind === 'bot-options' && !entry.answered
        ? `<div class="bubble-options">${entry.options
            .map(
              (o, i) =>
                `<button class="bubble-option-btn" data-wizard-option-entry="${esc(entry.id)}" data-wizard-option-index="${i}">${esc(o.label)}</button>`
            )
            .join('')}</div>`
        : '';
    return `
      <div class="chat-message incoming">
        <div class="chat-bubble incoming">${esc(entry.text)}${optionsHtml}</div>
      </div>`;
  }

  /** Swaps the normal compose textarea for a masked password input during
   *  the password step -- same id either way, so renderBody()'s generic
   *  focus-preserving logic keeps working unchanged. */
  function composeInputHtml() {
    if (isJiraWorkflow() && state.jiraWizard.step === 'password') {
      return `<input type="password" id="user-text" class="jira-password-input" placeholder="Enter password (masked)" value="${esc(state.userText)}" autocomplete="off" />`;
    }
    const disabled = isJiraComposeBusy();
    return `<textarea id="user-text" placeholder="${esc(placeholderForWorkflow())}" style="min-height:80px;" ${disabled ? 'disabled' : ''}>${esc(state.userText)}</textarea>`;
  }

  /** Beside Browse for every other workflow; for this one it's the "Review
   *  / select context" link into the Control panel's chunk checklist (once
   *  a ticket is loaded) plus the usual Select Skill/Instruction/Prompt
   *  links -- no Browse button, since context comes from the fetched
   *  ticket, not a picked file. */
  function jiraContextRowHtml() {
    const hasChunks = state.jiraWizard.chunks.length > 0;
    const reviewLabel = hasChunks
      ? `Review / select context (${state.jiraWizard.selectedChunkIds.size}/${state.jiraWizard.chunks.length})`
      : '';
    return `
      <div class="btn-row">
        ${hasChunks ? `<button class="link-btn" id="jira-control-link">${esc(reviewLabel)}</button>` : ''}
        ${contextPickerLinksHtml()}
      </div>`;
  }

  // ---------------- Wiring: main body ----------------
  function wireBody() {
    wireToggles(document.getElementById('body'), renderBody);

    const openSettingsForModel = document.getElementById('open-settings-for-model');
    if (openSettingsForModel) {
      openSettingsForModel.addEventListener('click', () => openSettingsSection('settingsWorkflowModel'));
    }

    const selectSkillLink = document.getElementById('select-skill-link');
    if (selectSkillLink) selectSkillLink.addEventListener('click', () => openSettingsSection('settingsSkills'));

    const selectInstructionLink = document.getElementById('select-instruction-link');
    if (selectInstructionLink) selectInstructionLink.addEventListener('click', () => openSettingsSection('settingsInstructions'));

    const selectPromptLink = document.getElementById('select-prompt-link');
    if (selectPromptLink) selectPromptLink.addEventListener('click', () => openSettingsSection('settingsPrompts'));

    const copyResponseBtn = document.getElementById('copy-response-btn');
    if (copyResponseBtn) {
      copyResponseBtn.addEventListener('click', () => copyResponseToClipboard());
    }

    const userText = document.getElementById('user-text');
    if (userText) {
      userText.addEventListener('input', (e) => {
        state.userText = e.target.value;
        scheduleContextEstimate();
      });
      // Enter sends (standard chat-app behavior); Shift+Enter still inserts
      // a newline. isComposing is checked so this doesn't fire mid-IME
      // composition (e.g. typing Japanese/Chinese/Korean via an input
      // method), where Enter is used to confirm a character, not submit.
      userText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          onSend();
        }
      });
    }

    const browseBtn = document.getElementById('browse-btn');
    if (browseBtn) {
      browseBtn.addEventListener('click', () => {
        state.fileParsing = true;
        renderBody();
        post({ type: 'browseFile' });
      });
    }

    const removeFileBtn = document.getElementById('remove-attached-file-btn');
    if (removeFileBtn) {
      removeFileBtn.addEventListener('click', () => {
        if (state.attachedFile) post({ type: 'clearAttachedFile', fileId: state.attachedFile.meta.fileId });
        state.attachedFile = null;
        state.contextMeter = null;
        state.fileSelectionDraft = {};
        renderBody();
      });
    }

    wireControlContextLinks(document.getElementById('body'));

    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', onSend);
    }

    wireIncidentSearchPanel();

    document.querySelectorAll('[data-wizard-option-entry]').forEach((btn) => {
      btn.addEventListener('click', () => {
        onJiraWizardOptionClick(
          btn.getAttribute('data-wizard-option-entry'),
          parseInt(btn.getAttribute('data-wizard-option-index'), 10)
        );
      });
    });

    const jiraControlLink = document.getElementById('jira-control-link');
    if (jiraControlLink) jiraControlLink.addEventListener('click', openJiraControlPanel);

    document.querySelectorAll('[data-suggested-question]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-suggested-question'), 10);
        state.userText = INCIDENT_SUGGESTED_QUESTIONS[idx];
        onSend();
      });
    });

    document.querySelectorAll('[data-download-csv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = state.chatEntries.find((e) => e.id === btn.getAttribute('data-download-csv'));
        const table = entry && parseMarkdownTable(entry.responseText);
        if (!table) return;
        post({ type: 'downloadIncidentAnalysisCsv', headers: table.headers, rows: table.rows });
      });
    });
  }

  function wireIncidentSearchPanel() {
    const malCodesInput = document.getElementById('incident-mal-codes');
    if (malCodesInput) {
      malCodesInput.addEventListener('input', (e) => {
        state.incidentSearch.malCodes = e.target.value;
      });
    }
    const dateFromInput = document.getElementById('incident-date-from');
    if (dateFromInput) {
      dateFromInput.addEventListener('change', (e) => {
        state.incidentSearch.dateFrom = e.target.value;
      });
    }
    const dateToInput = document.getElementById('incident-date-to');
    if (dateToInput) {
      dateToInput.addEventListener('change', (e) => {
        state.incidentSearch.dateTo = e.target.value;
      });
    }

    const fetchBtn = document.getElementById('fetch-incidents-btn');
    if (fetchBtn) fetchBtn.addEventListener('click', onFetchIncidents);

    const controlLink = document.getElementById('incident-control-link');
    if (controlLink) controlLink.addEventListener('click', openControlPanel);

    const newSearchBtn = document.getElementById('incident-new-search-btn');
    if (newSearchBtn) newSearchBtn.addEventListener('click', onNewIncidentSearch);
  }

  function onFetchIncidents() {
    const s = state.incidentSearch;
    const codes = s.malCodes.split(',').map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0) {
      toast('warn', 'Enter at least one MAL code.');
      return;
    }
    if (!s.dateFrom || !s.dateTo) {
      toast('warn', 'Select both a from date and a to date.');
      return;
    }
    post({ type: 'fetchIncidents', malCodes: codes, dateFrom: s.dateFrom, dateTo: s.dateTo });
  }

  /** "Start a new incident search" (item: retain the auto-selected Custom
   *  Prompt/Skill/Instruction, drop only the previously fetched incident
   *  data) -- clears the attached incident set and search fields, leaves
   *  every Skills/Instructions/Custom Prompt selection exactly as-is. */
  function onNewIncidentSearch() {
    if (state.attachedFile) post({ type: 'clearAttachedFile', fileId: state.attachedFile.meta.fileId });
    state.attachedFile = null;
    state.contextMeter = null;
    state.fileSelectionDraft = {};
    state.incidentSearch = { malCodes: '', dateFrom: '', dateTo: '', busy: false, summary: null };
    renderBody();
  }

  /** Wires the "Control the data sent in the context" link(s) within the
   *  given scope. Both can be present at once (the attached-file row's
   *  link, and the exceeded-context warning's link inside the context
   *  meter) -- wire each independently. Factored out of wireBody() so
   *  updateContextMeterDom()'s targeted re-render (see the 'contextMeter'
   *  message handler) can re-wire just the warning link without needing a
   *  full renderBody(). */
  function wireControlContextLinks(scope) {
    ['control-context-link', 'control-context-link-warning'].forEach((id) => {
      const el = scope.querySelector('#' + id);
      if (el) el.addEventListener('click', openControlPanel);
    });
  }

  /** Targeted update for the context meter: swaps only the meter's own DOM
   *  subtree instead of going through renderBody(). This message arrives
   *  ~500ms after every pause in typing (see scheduleContextEstimate's
   *  debounce), so routing it through a full body re-render would rebuild
   *  the compose textarea out from under the user on every such pause --
   *  destroying and recreating a focused element drops both its focus and
   *  its cursor position. Updating just this container sidesteps the
   *  problem entirely rather than papering over it with a focus-restore. */
  function updateContextMeterDom() {
    const container = document.getElementById('context-meter-container');
    if (!container) return;
    container.innerHTML = contextMeterHtml();
    wireControlContextLinks(container);
  }

  function scheduleContextEstimate() {
    if (contextEstimateTimer) clearTimeout(contextEstimateTimer);
    contextEstimateTimer = setTimeout(() => {
      if (!state.modelUid) return;
      post({
        type: 'estimateContext',
        workflowId: state.workflowId,
        modelUid: state.modelUid,
        userText: state.userText,
        selectedSkills: state.skills.filter((s) => state.selectedSkills.has(s.relativePath)),
        selectedInstructions: state.instructions.filter((i) => state.selectedInstructions.has(i.relativePath)),
        selectedPromptFile: state.selectedPromptFile,
        attachedFileId: state.attachedFile ? state.attachedFile.meta.fileId : null,
        jiraChunkIds: isJiraWorkflow() ? Array.from(state.jiraWizard.selectedChunkIds) : undefined,
      });
    }, 500);
  }

  function onSend() {
    if (state.streaming) return;

    if (isJiraWorkflow() && isJiraFreeTextStep(state.jiraWizard.step)) {
      handleJiraWizardAnswer(state.userText);
      return;
    }

    const requestText = state.userText.trim();
    if (!requestText) {
      toast('warn', 'Enter a request before sending.');
      return;
    }
    if (!state.modelUid) {
      toast('warn', 'Select a Copilot model first.');
      return;
    }

    const requestId = uid();
    const wf = state.workflows.find((w) => w.id === state.workflowId);

    state.streaming = true;
    state.collapsed.chat = false; // reveal the chat thread so the user can watch it happen
    state.requestId = requestId;
    state.lastUsage = null;
    state.pendingPromptTokens = null;
    // Optimistic UI: the request bubble (and the typing indicator that
    // stands in for the response) appears immediately, the same way a real
    // chat app never waits on the network before showing your own message.
    state.chatEntries.push({
      id: requestId,
      timestamp: new Date().toISOString(),
      workflowLabel: wf ? wf.label : 'Request',
      requestText,
      responseText: '',
      streaming: true,
      error: null,
      contextSummary: null,
    });
    state.userText = ''; // clear the compose box, like any chat app does on send
    renderBody();
    renderTokenFooter();
    scrollChatToBottom();

    post({
      type: 'sendPrompt',
      requestId,
      workflowId: state.workflowId,
      modelUid: state.modelUid,
      userText: requestText,
      selectedSkills: state.skills.filter((s) => state.selectedSkills.has(s.relativePath)),
      selectedInstructions: state.instructions.filter((i) => state.selectedInstructions.has(i.relativePath)),
      selectedPromptFile: state.selectedPromptFile,
      attachedFileId: state.attachedFile ? state.attachedFile.meta.fileId : null,
      jiraChunkIds: isJiraWorkflow() ? Array.from(state.jiraWizard.selectedChunkIds) : undefined,
    });
  }

  // ---------------- Settings overlay ----------------
  function renderSettings() {
    const overlay = document.getElementById('settings-overlay');
    if (!state.settingsOpen) {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      return;
    }
    overlay.classList.add('open');
    const modelOptions = state.models.length
      ? state.models.map((m) => `<option value="${esc(m.uid)}" ${m.uid === state.modelUid ? 'selected' : ''}>${esc(m.name)}${m.vendor ? ' (' + esc(m.vendor) + ')' : ''}</option>`).join('')
      : `<option value="">No models found</option>`;

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>Settings</h2>
        <button class="icon-btn" id="settings-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        <div id="settings-section-settingsWorkflowModel">
          <div class="settings-section">
            <h3>Workflow</h3>
            ${workflowCardBodyHtml()}
          </div>
          <div class="settings-section">
            <h3>Copilot Model</h3>
            <div class="field">
              <label class="field-label">Model used for sending requests and Test Connection</label>
              <select id="settings-model-select">${modelOptions}</select>
            </div>
          </div>
        </div>
        ${settingsSectionHtml('settingsSkills', 'Skills', state.selectedSkills.size, skillsBodyHtml())}
        ${settingsSectionHtml('settingsInstructions', 'Instructions', state.selectedInstructions.size, instructionsBodyHtml())}
        ${settingsSectionHtml('settingsPrompts', 'Custom Prompts', state.selectedPromptFile ? 1 : 0, promptsBodyHtml())}
        ${settingsSectionHtml(
          'settingsConnection',
          'Connection',
          0,
          `
          <div class="btn-row">
            <button class="btn" id="test-conn-btn" ${state.testConnBusy ? 'disabled' : ''}>${state.testConnBusy ? 'Testing…' : 'Test Connection'}</button>
          </div>
          <div class="hint">Sends the text "Who are you ?" to the model selected above and shows its reply below.</div>
          <div class="response-panel ${state.testConnResult ? '' : 'empty'}" data-placeholder="No test run yet.">${state.testConnResult ? esc(state.testConnResult) : ''}</div>
          ${state.testConnUsage ? `<div class="context-summary">Tokens — sent: ${fmtTok(state.testConnUsage.promptTokens)} · received: ${fmtTok(state.testConnUsage.completionTokens)} · total: ${fmtTok(state.testConnUsage.totalTokens)}</div>` : ''}
          `
        )}
        ${settingsSectionHtml(
          'settingsAuthor',
          'Author Content',
          0,
          `
          <div class="btn-row" style="flex-direction:column; align-items:stretch;">
            <button class="btn secondary block" data-wizard="skill">Add New Skill</button>
            <button class="btn secondary block" data-wizard="instruction">Add New Instruction</button>
            <button class="btn secondary block" data-wizard="prompt">Add New Prompt</button>
          </div>
          `
        )}
      </div>
    `;

    wireSettings(overlay);
  }

  function wireSettings(overlay) {
    document.getElementById('settings-close').addEventListener('click', () => {
      state.settingsOpen = false;
      renderSettings();
    });

    wireToggles(overlay, renderSettings);

    const workflowSelect = document.getElementById('workflow-select');
    if (workflowSelect) {
      workflowSelect.addEventListener('change', (e) => {
        applyWorkflowSwitch(e.target.value);
        renderSettings();
        renderBody();
        scheduleContextEstimate();
      });
    }

    document.getElementById('settings-model-select').addEventListener('change', (e) => {
      state.modelUid = e.target.value;
      renderBody();
      scheduleContextEstimate();
    });

    document.getElementById('test-conn-btn').addEventListener('click', () => {
      if (!state.modelUid) {
        toast('warn', 'Select a model first.');
        return;
      }
      state.testConnBusy = true;
      renderSettings();
      post({ type: 'testConnection', modelUid: state.modelUid });
    });

    overlay.querySelectorAll('[data-wizard]').forEach((btn) => {
      btn.addEventListener('click', () => startWizard(btn.getAttribute('data-wizard')));
    });

    overlay.querySelectorAll('input[type=checkbox][data-kind]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const path = e.target.getAttribute('data-path');
        const kind = e.target.getAttribute('data-kind');
        const set = kind === 'skill' ? state.selectedSkills : state.selectedInstructions;
        if (e.target.checked) set.add(path);
        else set.delete(path);
        renderSettings();
        scheduleContextEstimate();
      });
    });

    overlay.querySelectorAll('[data-open-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openManagedFileEditor(btn.getAttribute('data-open-kind'), btn.getAttribute('data-open-path'));
      });
    });

    const managedEditor = document.getElementById('managed-file-editor');
    if (managedEditor) {
      managedEditor.addEventListener('input', (e) => {
        state.managedFileEditor.content = e.target.value;
        state.managedFileEditor.dirty = true;
      });
    }
    const managedExpandBtn = document.getElementById('managed-file-expand-btn');
    if (managedExpandBtn) {
      managedExpandBtn.addEventListener('click', () => {
        state.managedFileEditor.expanded = !state.managedFileEditor.expanded;
        renderSettings();
      });
    }
    const managedSaveBtn = document.getElementById('managed-file-save-btn');
    if (managedSaveBtn) {
      managedSaveBtn.addEventListener('click', () => {
        const ed = state.managedFileEditor;
        post({ type: 'saveManagedFile', kind: ed.kind, file: ed.file, fileName: ed.file.fileName, content: ed.content });
        ed.dirty = false;
      });
    }
    const managedCloseBtn = document.getElementById('managed-file-close-btn');
    if (managedCloseBtn) {
      managedCloseBtn.addEventListener('click', () => {
        state.managedFileEditor = null;
        renderSettings();
      });
    }

    const promptSelect = document.getElementById('prompt-select');
    if (promptSelect) {
      promptSelect.addEventListener('change', (e) => {
        const path = e.target.value;
        if (!path) {
          state.selectedPromptFile = null;
          state.promptFileContent = '';
          state.promptFileDirty = false;
          renderSettings();
          scheduleContextEstimate();
          return;
        }
        const file = state.prompts.find((p) => p.relativePath === path);
        state.selectedPromptFile = file || null;
        state.promptFileDirty = false;
        if (file) post({ type: 'loadPrompt', file });
        renderSettings();
        scheduleContextEstimate();
      });
    }

    const promptEditor = document.getElementById('prompt-editor');
    if (promptEditor) {
      promptEditor.addEventListener('input', (e) => {
        state.promptFileContent = e.target.value;
        state.promptFileDirty = true;
      });
    }

    const promptEditorExpandBtn = document.getElementById('prompt-editor-expand-btn');
    if (promptEditorExpandBtn) {
      promptEditorExpandBtn.addEventListener('click', () => {
        state.promptEditorExpanded = !state.promptEditorExpanded;
        renderSettings();
      });
    }

    const saveSame = document.getElementById('prompt-save-same');
    if (saveSame) {
      saveSame.addEventListener('click', () => {
        post({
          type: 'savePrompt',
          file: state.selectedPromptFile,
          fileName: state.selectedPromptFile.fileName,
          content: state.promptFileContent,
        });
        state.promptFileDirty = false;
      });
    }

    const saveNew = document.getElementById('prompt-save-new');
    if (saveNew) {
      saveNew.addEventListener('click', () => {
        const nameInput = document.getElementById('prompt-save-name');
        let name = (nameInput.value || '').trim();
        if (!name) {
          toast('warn', 'Enter a file name before saving.');
          return;
        }
        if (!name.endsWith('.md')) name += '.prompt.md';
        post({ type: 'savePrompt', file: null, fileName: name, content: state.promptFileContent });
        state.promptFileDirty = false;
      });
    }
  }

  function closeIcon() {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
  }

  // ---------------- Wizard overlay ----------------
  function startWizard(kind) {
    const schema = state.wizards.find((w) => w.kind === kind);
    if (!schema) return;
    state.wizard = { kind, stepIndex: 0, data: {}, schema };
    schema.steps.forEach((step) =>
      step.fields.forEach((f) => {
        if (f.defaultValue) state.wizard.data[f.key] = f.defaultValue;
      })
    );
    renderWizard();
  }

  function closeWizard() {
    state.wizard = null;
    renderWizard();
  }

  function renderWizard() {
    const overlay = document.getElementById('wizard-overlay');
    if (!state.wizard) {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      return;
    }
    overlay.classList.add('open');
    const { schema, stepIndex, data } = state.wizard;
    const step = schema.steps[stepIndex];
    const total = schema.steps.length;
    const isLast = stepIndex === total - 1;

    const fieldsHtml = step.fields
      .map((f) => {
        const value = data[f.key] || '';
        const requiredMark = f.required ? '<span class="required"> *</span>' : '';
        let control = '';
        if (f.type === 'textarea') {
          control = `<textarea data-field="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea>`;
        } else if (f.type === 'select') {
          const opts = (f.options || [])
            .map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`)
            .join('');
          control = `<select data-field="${esc(f.key)}">${opts}</select>`;
        } else {
          control = `<input type="text" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" value="${esc(value)}" />`;
        }
        return `<div class="field"><label class="field-label">${esc(f.label)}${requiredMark}</label>${control}${f.help ? `<span class="hint">${esc(f.help)}</span>` : ''}</div>`;
      })
      .join('');

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>${esc(schema.title)}</h2>
        <button class="icon-btn" id="wizard-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        <div class="wizard-progress">
          <span>Step ${stepIndex + 1} / ${total}</span>
          <div class="bar"><div style="width:${Math.round(((stepIndex + 1) / total) * 100)}%"></div></div>
        </div>
        <div class="wizard-step">
          <h3>${esc(step.title)}</h3>
          <p class="step-desc">${esc(step.description)}</p>
          ${fieldsHtml}
        </div>
        <div class="btn-row">
          ${stepIndex > 0 ? `<button class="btn secondary" id="wizard-back">&larr; Back</button>` : ''}
          <button class="btn" id="wizard-next">${isLast ? 'Save' : 'Next →'}</button>
        </div>
      </div>
    `;

    document.getElementById('wizard-close').addEventListener('click', closeWizard);
    overlay.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('input', (e) => {
        state.wizard.data[e.target.getAttribute('data-field')] = e.target.value;
      });
      el.addEventListener('change', (e) => {
        state.wizard.data[e.target.getAttribute('data-field')] = e.target.value;
      });
    });

    const backBtn = document.getElementById('wizard-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      state.wizard.stepIndex -= 1;
      renderWizard();
    });

    document.getElementById('wizard-next').addEventListener('click', () => {
      const missing = step.fields.filter((f) => f.required && !String(state.wizard.data[f.key] || '').trim());
      if (missing.length) {
        toast('warn', `Please fill in: ${missing.map((m) => m.label).join(', ')}`);
        return;
      }
      if (isLast) {
        post({ type: 'saveWizardFile', kind: schema.kind, data: state.wizard.data });
      } else {
        state.wizard.stepIndex += 1;
        renderWizard();
      }
    });
  }

  // ---------------- Control the data sent in the context ----------------
  function openControlPanel() {
    if (!state.attachedFile) return;
    state.controlPanelOpen = true;
    renderControlPanel();
  }

  function closeControlPanel() {
    state.controlPanelOpen = false;
    renderControlPanel();
  }

  /** Generate Feature File From Jira Story's own "Control the data sent in
   *  the context" -- a checklist of chunks (AC segments/Description/linked
   *  tickets/attachments) instead of the single-attached-file range
   *  controls below, since this workflow can have several simultaneously
   *  selectable pieces of context. Uses a separate open/close pair (rather
   *  than reusing openControlPanel's state.attachedFile guard) since Jira
   *  context was deliberately kept out of the shared attach-file plumbing
   *  -- see JiraContextStore's doc comment on the host side for why. */
  function openJiraControlPanel() {
    if (state.jiraWizard.chunks.length === 0) return;
    state.jiraWizard.controlPanelOpen = true;
    state.jiraWizard.controlPanelChunkId = null;
    renderControlPanel();
  }

  function closeJiraControlPanel() {
    state.jiraWizard.controlPanelOpen = false;
    state.jiraWizard.controlPanelChunkId = null;
    renderControlPanel();
  }

  function jiraChunkKindLabel(kind) {
    switch (kind) {
      case 'ac':
        return 'Acceptance Criteria';
      case 'description':
        return 'Description';
      case 'linked-ticket':
        return 'Linked Ticket';
      case 'attachment':
        return 'Attachment';
      default:
        return kind;
    }
  }

  function renderControlPanel() {
    const overlay = document.getElementById('control-overlay');

    if (state.jiraWizard.controlPanelOpen) {
      renderJiraControlPanel(overlay);
      return;
    }

    if (!state.controlPanelOpen || !state.attachedFile) {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      return;
    }
    overlay.classList.add('open');

    const { meta } = state.attachedFile;
    const draft = state.fileSelectionDraft;

    let fieldsHtml = '';
    let noteHtml = '';

    if (meta.kind === 'pdf') {
      noteHtml = `<div class="hint">PDF page numbers are exact -- taken directly from the document.</div>`;
      fieldsHtml = `
        <div class="range-row">
          <div class="field"><label class="field-label">From page</label><input type="number" min="1" max="${meta.pageCount}" id="cp-page-from" value="${draft.pageFrom || ''}" placeholder="1" /></div>
          <div class="field"><label class="field-label">To page</label><input type="number" min="1" max="${meta.pageCount}" id="cp-page-to" value="${draft.pageTo || ''}" placeholder="${meta.pageCount}" /></div>
        </div>`;
    } else if (meta.kind === 'docx') {
      noteHtml = `<div class="hint">Word documents don't store real page numbers -- pagination is computed by Word at print/display time from fonts and page setup. This range is an approximation based on ${meta.approxPageBreaks} manual page break${meta.approxPageBreaks === 1 ? '' : 's'} detected in the document, dividing its text evenly. Tables in the document are included as flattened text.</div>`;
      fieldsHtml = `
        <div class="range-row">
          <div class="field"><label class="field-label">From page (approx.)</label><input type="number" min="1" max="${meta.pageCount}" id="cp-page-from" value="${draft.pageFrom || ''}" placeholder="1" /></div>
          <div class="field"><label class="field-label">To page (approx.)</label><input type="number" min="1" max="${meta.pageCount}" id="cp-page-to" value="${draft.pageTo || ''}" placeholder="${meta.pageCount}" /></div>
        </div>`;
    } else if (meta.kind === 'csv' && meta.sourceKind === 'servicenow-incidents') {
      const incidents = meta.incidentSummary || [];
      const selected = new Set(
        draft.selectedIncidentNumbers && draft.selectedIncidentNumbers.length
          ? draft.selectedIncidentNumbers
          : incidents.map((row) => row.number) // nothing unchecked yet -- default to everything selected
      );
      noteHtml = `<div class="hint">${incidents.length} incident${incidents.length === 1 ? '' : 's'} fetched. Select which to include in the LLM's context, then Apply Selection -- useful once the full set no longer fits the Context Limit below.</div>`;
      const rows = incidents
        .map(
          (row) => `
        <tr>
          <td><input type="checkbox" class="cp-incident-toggle" data-number="${esc(row.number)}" ${selected.has(row.number) ? 'checked' : ''} /></td>
          <td>${esc(row.number)}</td>
          <td>${esc(row.shortDescription)}</td>
          <td><span class="severity-badge ${severityClass(row.severity)}">${esc(row.severity || '—')}</span></td>
        </tr>`
        )
        .join('');
      fieldsHtml = `
        <div class="btn-row">
          <button class="link-btn" id="cp-incident-select-all">Select all</button>
          <button class="link-btn" id="cp-incident-select-none">Select none</button>
        </div>
        <div class="history-table-wrap chat-inline">
          <table class="history-table incident-table">
            <thead><tr><th></th><th>Incident</th><th>Short Description</th><th>Severity</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4" class="empty-hint">No incidents in this result set.</td></tr>`}</tbody>
          </table>
        </div>`;
    } else if (meta.kind === 'csv') {
      noteHtml = `<div class="hint">Detected columns: ${meta.csvColumns.map(esc).join(', ')}</div>`;
      fieldsHtml = `
        <div class="field">
          <label class="field-label">Columns to include (comma-separated; blank = all)</label>
          <input type="text" id="cp-csv-columns" value="${esc((draft.csvColumns || []).join(', '))}" placeholder="${esc(meta.csvColumns.slice(0, 3).join(', '))}..." />
        </div>
        <div class="range-row">
          <div class="field"><label class="field-label">From row</label><input type="number" min="1" max="${meta.csvTotalRows}" id="cp-csv-row-from" value="${draft.csvRowFrom || ''}" placeholder="1" /></div>
          <div class="field"><label class="field-label">To row</label><input type="number" min="1" max="${meta.csvTotalRows}" id="cp-csv-row-to" value="${draft.csvRowTo || ''}" placeholder="${meta.csvTotalRows}" /></div>
        </div>`;
    } else if (meta.kind === 'xlsx') {
      noteHtml = `<div class="hint">Select one or more sheets. Unselected sheets are left out entirely. If none are selected, the first sheet is sent by default.</div>`;
      fieldsHtml = meta.sheets
        .map((sheet) => {
          const sel = (draft.sheetSelections || {})[sheet.name];
          const checked = !!sel;
          return `
          <div class="sheet-selection-block">
            <label class="check-row">
              <input type="checkbox" class="cp-sheet-toggle" data-sheet="${esc(sheet.name)}" ${checked ? 'checked' : ''} />
              <span>${esc(sheet.name)} (${sheet.totalRows} row${sheet.totalRows === 1 ? '' : 's'})</span>
            </label>
            <div class="field">
              <label class="field-label">Columns (comma-separated; blank = all)</label>
              <input type="text" class="cp-sheet-columns" data-sheet="${esc(sheet.name)}" ${checked ? '' : 'disabled'} value="${esc((sel && sel.columns || []).join(', '))}" placeholder="${esc(sheet.columns.slice(0, 3).join(', '))}..." />
            </div>
            <div class="range-row">
              <div class="field"><label class="field-label">From row</label><input type="number" min="1" class="cp-sheet-row-from" data-sheet="${esc(sheet.name)}" ${checked ? '' : 'disabled'} value="${(sel && sel.rowFrom) || ''}" placeholder="1" /></div>
              <div class="field"><label class="field-label">To row</label><input type="number" min="1" class="cp-sheet-row-to" data-sheet="${esc(sheet.name)}" ${checked ? '' : 'disabled'} value="${(sel && sel.rowTo) || ''}" placeholder="${sheet.totalRows}" /></div>
            </div>
          </div>`;
        })
        .join('');
    } else {
      noteHtml = `<div class="hint">Plain text file -- ${meta.totalLines} line${meta.totalLines === 1 ? '' : 's'} detected.</div>`;
      fieldsHtml = `
        <div class="range-row">
          <div class="field"><label class="field-label">From line</label><input type="number" min="1" max="${meta.totalLines}" id="cp-line-from" value="${draft.lineFrom || ''}" placeholder="1" /></div>
          <div class="field"><label class="field-label">To line</label><input type="number" min="1" max="${meta.totalLines}" id="cp-line-to" value="${draft.lineTo || ''}" placeholder="${meta.totalLines}" /></div>
        </div>`;
    }

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>Control the Data Sent in the Context</h2>
        <button class="icon-btn" id="cp-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        <div class="hint">${meta.sourceKind === 'servicenow-incidents' ? esc(meta.fileName) : `File: ${esc(meta.fileName)} (detected as ${esc(meta.kind.toUpperCase())})`}</div>
        ${noteHtml}
        ${fieldsHtml}
        <div class="btn-row">
          <button class="btn" id="cp-apply">Apply Selection</button>
          <button class="btn secondary" id="cp-reset">Reset to Full File</button>
        </div>
      </div>
    `;

    document.getElementById('cp-close').addEventListener('click', closeControlPanel);

    document.getElementById('cp-reset')?.addEventListener('click', () => {
      state.fileSelectionDraft = {};
      renderControlPanel();
    });

    document.getElementById('cp-apply')?.addEventListener('click', () => applyControlPanelSelection(meta));

    if (meta.kind === 'xlsx') {
      overlay.querySelectorAll('.cp-sheet-toggle').forEach((el) => {
        el.addEventListener('change', (e) => {
          const sheetName = e.target.getAttribute('data-sheet');
          draft.sheetSelections = draft.sheetSelections || {};
          if (e.target.checked) {
            draft.sheetSelections[sheetName] = draft.sheetSelections[sheetName] || {};
          } else {
            delete draft.sheetSelections[sheetName];
          }
          renderControlPanel();
        });
      });
    }

    if (meta.kind === 'csv' && meta.sourceKind === 'servicenow-incidents') {
      document.getElementById('cp-incident-select-all')?.addEventListener('click', () => {
        overlay.querySelectorAll('.cp-incident-toggle').forEach((el) => { el.checked = true; });
      });
      document.getElementById('cp-incident-select-none')?.addEventListener('click', () => {
        overlay.querySelectorAll('.cp-incident-toggle').forEach((el) => { el.checked = false; });
      });
    }
  }

  function applyControlPanelSelection(meta) {
    const draft = state.fileSelectionDraft;
    const num = (id) => {
      const el = document.getElementById(id);
      const v = el && el.value ? parseInt(el.value, 10) : undefined;
      return Number.isFinite(v) ? v : undefined;
    };

    if (meta.kind === 'pdf' || meta.kind === 'docx') {
      draft.pageFrom = num('cp-page-from');
      draft.pageTo = num('cp-page-to');
    } else if (meta.kind === 'csv' && meta.sourceKind === 'servicenow-incidents') {
      const overlay = document.getElementById('control-overlay');
      draft.selectedIncidentNumbers = Array.from(overlay.querySelectorAll('.cp-incident-toggle:checked')).map((el) =>
        el.getAttribute('data-number')
      );
    } else if (meta.kind === 'csv') {
      const colsInput = document.getElementById('cp-csv-columns');
      draft.csvColumns = colsInput && colsInput.value.trim()
        ? colsInput.value.split(',').map((c) => c.trim()).filter(Boolean)
        : [];
      draft.csvRowFrom = num('cp-csv-row-from');
      draft.csvRowTo = num('cp-csv-row-to');
    } else if (meta.kind === 'xlsx') {
      const overlay = document.getElementById('control-overlay');
      overlay.querySelectorAll('.cp-sheet-toggle:checked').forEach((el) => {
        const sheetName = el.getAttribute('data-sheet');
        const colsInput = overlay.querySelector(`.cp-sheet-columns[data-sheet="${CSS.escape(sheetName)}"]`);
        const fromInput = overlay.querySelector(`.cp-sheet-row-from[data-sheet="${CSS.escape(sheetName)}"]`);
        const toInput = overlay.querySelector(`.cp-sheet-row-to[data-sheet="${CSS.escape(sheetName)}"]`);
        draft.sheetSelections = draft.sheetSelections || {};
        draft.sheetSelections[sheetName] = {
          columns: colsInput && colsInput.value.trim() ? colsInput.value.split(',').map((c) => c.trim()).filter(Boolean) : [],
          rowFrom: fromInput && fromInput.value ? parseInt(fromInput.value, 10) : undefined,
          rowTo: toInput && toInput.value ? parseInt(toInput.value, 10) : undefined,
        };
      });
    } else {
      draft.lineFrom = num('cp-line-from');
      draft.lineTo = num('cp-line-to');
    }

    post({ type: 'updateFileSelection', fileId: state.attachedFile.meta.fileId, selection: draft });
    closeControlPanel();
    scheduleContextEstimate();
  }

  /** The chunk checklist (default view of the Jira Control panel): every
   *  AC segment/Description/linked-ticket/attachment, a checkbox each,
   *  and a "Range…" link on attachments that drills into
   *  renderJiraAttachmentPanel() for that one attachment's own page/row/
   *  sheet controls. */
  function renderJiraControlPanel(overlay) {
    if (!state.jiraWizard.controlPanelOpen) {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      return;
    }
    overlay.classList.add('open');

    const drillChunk = state.jiraWizard.controlPanelChunkId
      ? state.jiraWizard.chunks.find((c) => c.id === state.jiraWizard.controlPanelChunkId)
      : null;
    if (drillChunk && drillChunk.attachmentMeta) {
      renderJiraAttachmentPanel(overlay, drillChunk);
      return;
    }

    const rows = state.jiraWizard.chunks
      .map((c) => {
        const checked = state.jiraWizard.selectedChunkIds.has(c.id);
        return `
        <tr>
          <td><input type="checkbox" class="cp-jira-chunk-toggle" data-chunk-id="${esc(c.id)}" ${checked ? 'checked' : ''} /></td>
          <td>${esc(jiraChunkKindLabel(c.kind))}</td>
          <td>${esc(c.label)}</td>
          <td class="num">${c.charCount.toLocaleString()} chars</td>
          <td>${c.kind === 'attachment' ? `<button class="link-btn" data-jira-drill="${esc(c.id)}">Range…</button>` : ''}</td>
        </tr>`;
      })
      .join('');

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>Control the Data Sent in the Context</h2>
        <button class="icon-btn" id="jira-cp-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        <div class="hint">${state.jiraWizard.ticketKey ? esc(state.jiraWizard.ticketKey) + ': ' : ''}${esc(state.jiraWizard.ticketSummary || '')} -- select which pieces of context to include, then Apply Selection.</div>
        <div class="btn-row">
          <button class="link-btn" id="jira-cp-select-all">Select all</button>
          <button class="link-btn" id="jira-cp-select-none">Select none</button>
        </div>
        <div class="history-table-wrap chat-inline">
          <table class="history-table incident-table">
            <thead><tr><th></th><th>Type</th><th>Label</th><th class="num">Size</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5" class="empty-hint">No context loaded yet.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="btn-row">
          <button class="btn" id="jira-cp-apply">Apply Selection</button>
        </div>
      </div>
    `;

    document.getElementById('jira-cp-close').addEventListener('click', closeJiraControlPanel);
    document.getElementById('jira-cp-select-all')?.addEventListener('click', () => {
      overlay.querySelectorAll('.cp-jira-chunk-toggle').forEach((el) => {
        el.checked = true;
      });
    });
    document.getElementById('jira-cp-select-none')?.addEventListener('click', () => {
      overlay.querySelectorAll('.cp-jira-chunk-toggle').forEach((el) => {
        el.checked = false;
      });
    });
    document.getElementById('jira-cp-apply')?.addEventListener('click', () => {
      state.jiraWizard.selectedChunkIds = new Set(
        Array.from(overlay.querySelectorAll('.cp-jira-chunk-toggle:checked')).map((el) => el.getAttribute('data-chunk-id'))
      );
      closeJiraControlPanel();
      scheduleContextEstimate();
    });
    overlay.querySelectorAll('[data-jira-drill]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.jiraWizard.controlPanelChunkId = btn.getAttribute('data-jira-drill');
        renderControlPanel();
      });
    });
  }

  /** One attachment chunk's own page/row/sheet range controls -- reuses
   *  the AttachedFileMeta shape (attachmentMeta) so this is structurally
   *  the same docx/csv/xlsx UI the Browse-file feature already has, just
   *  scoped to one chunk's own selection draft instead of the single
   *  fileSelectionDraft. Attachments here are only ever docx/csv/xlsx
   *  (the host only parses those three kinds for Jira attachments). */
  function renderJiraAttachmentPanel(overlay, chunk) {
    const meta = chunk.attachmentMeta;
    const draft = state.jiraWizard.attachmentSelectionDrafts[chunk.id] || {};
    let noteHtml = '';
    let fieldsHtml = '';

    if (meta.kind === 'docx') {
      noteHtml = `<div class="hint">Word documents don't store real page numbers -- this range is an approximation. Leave blank to include the whole document.</div>`;
      fieldsHtml = `
        <div class="range-row">
          <div class="field"><label class="field-label">From page (approx.)</label><input type="number" min="1" max="${meta.pageCount}" id="jcp-page-from" value="${draft.pageFrom || ''}" placeholder="1" /></div>
          <div class="field"><label class="field-label">To page (approx.)</label><input type="number" min="1" max="${meta.pageCount}" id="jcp-page-to" value="${draft.pageTo || ''}" placeholder="${meta.pageCount}" /></div>
        </div>`;
    } else if (meta.kind === 'csv') {
      noteHtml = `<div class="hint">Detected columns: ${meta.csvColumns.map(esc).join(', ')}. Leave the row range blank to include every row.</div>`;
      fieldsHtml = `
        <div class="range-row">
          <div class="field"><label class="field-label">From row</label><input type="number" min="1" max="${meta.csvTotalRows}" id="jcp-csv-row-from" value="${draft.csvRowFrom || ''}" placeholder="1" /></div>
          <div class="field"><label class="field-label">To row</label><input type="number" min="1" max="${meta.csvTotalRows}" id="jcp-csv-row-to" value="${draft.csvRowTo || ''}" placeholder="${meta.csvTotalRows}" /></div>
        </div>`;
    } else if (meta.kind === 'xlsx') {
      noteHtml = `<div class="hint">Select one or more sheets and, optionally, a row range for each. If none are selected, the first sheet is sent by default.</div>`;
      fieldsHtml = meta.sheets
        .map((sheet) => {
          const sel = (draft.sheetSelections || {})[sheet.name];
          const checked = !!sel;
          return `
          <div class="sheet-selection-block">
            <label class="check-row">
              <input type="checkbox" class="jcp-sheet-toggle" data-sheet="${esc(sheet.name)}" ${checked ? 'checked' : ''} />
              <span>${esc(sheet.name)} (${sheet.totalRows} row${sheet.totalRows === 1 ? '' : 's'})</span>
            </label>
            <div class="range-row">
              <div class="field"><label class="field-label">From row</label><input type="number" min="1" class="jcp-sheet-row-from" data-sheet="${esc(sheet.name)}" ${checked ? '' : 'disabled'} value="${(sel && sel.rowFrom) || ''}" placeholder="1" /></div>
              <div class="field"><label class="field-label">To row</label><input type="number" min="1" class="jcp-sheet-row-to" data-sheet="${esc(sheet.name)}" ${checked ? '' : 'disabled'} value="${(sel && sel.rowTo) || ''}" placeholder="${sheet.totalRows}" /></div>
            </div>
          </div>`;
        })
        .join('');
    }

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>${esc(meta.fileName)}</h2>
        <button class="icon-btn" id="jcp-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        ${noteHtml}
        ${fieldsHtml}
        <div class="btn-row">
          <button class="btn" id="jcp-apply">Apply Range</button>
          <button class="btn secondary" id="jcp-back">← Back to context list</button>
        </div>
      </div>
    `;

    document.getElementById('jcp-close').addEventListener('click', closeJiraControlPanel);
    document.getElementById('jcp-back').addEventListener('click', () => {
      state.jiraWizard.controlPanelChunkId = null;
      renderControlPanel();
    });

    if (meta.kind === 'xlsx') {
      overlay.querySelectorAll('.jcp-sheet-toggle').forEach((el) => {
        el.addEventListener('change', (e) => {
          const sheetName = e.target.getAttribute('data-sheet');
          draft.sheetSelections = draft.sheetSelections || {};
          if (e.target.checked) {
            draft.sheetSelections[sheetName] = draft.sheetSelections[sheetName] || {};
          } else {
            delete draft.sheetSelections[sheetName];
          }
          state.jiraWizard.attachmentSelectionDrafts[chunk.id] = draft;
          renderControlPanel();
        });
      });
    }

    document.getElementById('jcp-apply').addEventListener('click', () => applyJiraAttachmentSelection(chunk, meta, draft));
  }

  function applyJiraAttachmentSelection(chunk, meta, draft) {
    const num = (id) => {
      const el = document.getElementById(id);
      const v = el && el.value ? parseInt(el.value, 10) : undefined;
      return Number.isFinite(v) ? v : undefined;
    };

    if (meta.kind === 'docx') {
      draft.pageFrom = num('jcp-page-from');
      draft.pageTo = num('jcp-page-to');
    } else if (meta.kind === 'csv') {
      draft.csvRowFrom = num('jcp-csv-row-from');
      draft.csvRowTo = num('jcp-csv-row-to');
    } else if (meta.kind === 'xlsx') {
      const overlay = document.getElementById('control-overlay');
      overlay.querySelectorAll('.jcp-sheet-toggle:checked').forEach((el) => {
        const sheetName = el.getAttribute('data-sheet');
        const fromInput = overlay.querySelector(`.jcp-sheet-row-from[data-sheet="${CSS.escape(sheetName)}"]`);
        const toInput = overlay.querySelector(`.jcp-sheet-row-to[data-sheet="${CSS.escape(sheetName)}"]`);
        draft.sheetSelections = draft.sheetSelections || {};
        draft.sheetSelections[sheetName] = {
          rowFrom: fromInput && fromInput.value ? parseInt(fromInput.value, 10) : undefined,
          rowTo: toInput && toInput.value ? parseInt(toInput.value, 10) : undefined,
        };
      });
    }

    state.jiraWizard.attachmentSelectionDrafts[chunk.id] = draft;
    post({ type: 'updateJiraAttachmentSelection', chunkId: chunk.id, selection: draft });
    state.jiraWizard.controlPanelChunkId = null;
    renderControlPanel();
  }

  // ---------------- Token Usage History overlay ----------------
  function openHistory() {
    state.historyOpen = true;
    state.historyConfirmClear = false;
    renderHistory();
    post({ type: 'loadTokenHistory' });
  }

  function closeHistory() {
    state.historyOpen = false;
    state.historyConfirmClear = false;
    renderHistory();
  }

  function fmtTimestamp(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function distinctValues(entries, key) {
    return Array.from(new Set(entries.map((e) => e[key]).filter(Boolean))).sort();
  }

  /** Pure client-side filtering over the already-loaded array -- negligible
   *  cost even for a couple thousand rows, so filters apply instantly with
   *  no round trip to the extension host. All active filters combine with AND. */
  function getFilteredHistoryEntries() {
    const entries = state.historyEntries || [];
    const f = state.historyFilters;
    const search = f.search.trim().toLowerCase();
    const dateFrom = f.dateFrom ? new Date(f.dateFrom + 'T00:00:00') : null;
    const dateTo = f.dateTo ? new Date(f.dateTo + 'T23:59:59.999') : null;

    return entries.filter((e) => {
      if (f.workflow && e.workflowLabel !== f.workflow) return false;
      if (f.model && e.modelName !== f.model) return false;
      if (f.host && e.hostname !== f.host) return false;
      if (dateFrom || dateTo) {
        const t = new Date(e.timestamp).getTime();
        if (dateFrom && t < dateFrom.getTime()) return false;
        if (dateTo && t > dateTo.getTime()) return false;
      }
      if (search) {
        const haystack = `${e.workflowLabel} ${e.modelName} ${e.hostname}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function historyFiltersHtml() {
    const all = state.historyEntries || [];
    const f = state.historyFilters;
    const workflowOptions = ['<option value="">All workflows</option>']
      .concat(distinctValues(all, 'workflowLabel').map((w) => `<option value="${esc(w)}" ${f.workflow === w ? 'selected' : ''}>${esc(w)}</option>`))
      .join('');
    const modelOptions = ['<option value="">All models</option>']
      .concat(distinctValues(all, 'modelName').map((m) => `<option value="${esc(m)}" ${f.model === m ? 'selected' : ''}>${esc(m)}</option>`))
      .join('');
    const hostOptions = ['<option value="">All hosts</option>']
      .concat(distinctValues(all, 'hostname').map((h) => `<option value="${esc(h)}" ${f.host === h ? 'selected' : ''}>${esc(h)}</option>`))
      .join('');

    return `
      <div class="history-filters">
        <div class="field">
          <label class="field-label">Workflow</label>
          <select id="hf-workflow">${workflowOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">Model</label>
          <select id="hf-model">${modelOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">Host</label>
          <select id="hf-host">${hostOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">From date</label>
          <input type="date" id="hf-date-from" value="${esc(f.dateFrom)}" />
        </div>
        <div class="field">
          <label class="field-label">To date</label>
          <input type="date" id="hf-date-to" value="${esc(f.dateTo)}" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Search</label>
          <input type="text" id="hf-search" placeholder="Search workflow, model, host..." value="${esc(f.search)}" />
        </div>
      </div>
      <div class="btn-row">
        <button class="link-btn" id="hf-clear">Clear filters</button>
      </div>
    `;
  }

  function wireHistoryFilters() {
    const bind = (id, key, transform) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(key === 'search' ? 'input' : 'change', (e) => {
        state.historyFilters[key] = transform ? transform(e.target.value) : e.target.value;
        renderHistory();
      });
    };
    bind('hf-workflow', 'workflow');
    bind('hf-model', 'model');
    bind('hf-host', 'host');
    bind('hf-date-from', 'dateFrom');
    bind('hf-date-to', 'dateTo');
    bind('hf-search', 'search');

    const clearBtn = document.getElementById('hf-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.historyFilters = { workflow: '', model: '', host: '', dateFrom: '', dateTo: '', search: '' };
        renderHistory();
      });
    }
  }

  function renderHistory() {
    const overlay = document.getElementById('history-overlay');
    if (!state.historyOpen) {
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      return;
    }
    overlay.classList.add('open');

    const allEntries = state.historyEntries;
    const loading = allEntries === null;
    const filtered = loading ? [] : getFilteredHistoryEntries();
    const filtersActive = Object.values(state.historyFilters).some((v) => v);

    let bodyHtml;
    if (loading) {
      bodyHtml = `<div class="empty-hint">Loading history…</div>`;
    } else if (allEntries.length === 0) {
      bodyHtml = `<div class="empty-hint">No token usage recorded yet. Send a request from the main panel to start building history.</div>`;
    } else {
      const rows = filtered
        .map(
          (e) => `
          <tr>
            <td>${esc(fmtTimestamp(e.timestamp))}</td>
            <td>${esc(e.workflowLabel)}</td>
            <td>${esc(e.modelName)}</td>
            <td class="num tok-up">${fmtTok(e.promptTokens)}</td>
            <td class="num tok-down">${fmtTok(e.completionTokens)}</td>
            <td class="num tok-total">${fmtTok(e.totalTokens)}</td>
            <td>${esc(e.hostname)}</td>
          </tr>`
        )
        .join('');

      const totals = filtered.reduce(
        (acc, e) => ({
          promptTokens: acc.promptTokens + e.promptTokens,
          completionTokens: acc.completionTokens + e.completionTokens,
          totalTokens: acc.totalTokens + e.totalTokens,
        }),
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      );

      const countLine = filtersActive
        ? `${filtered.length} of ${allEntries.length} request${allEntries.length === 1 ? '' : 's'} match the current filters`
        : `${allEntries.length} recorded request${allEntries.length === 1 ? '' : 's'}`;

      bodyHtml = `
        ${historyFiltersHtml()}
        <div class="hint">${countLine} · total: ↑ ${fmtTok(totals.promptTokens)} · ↓ ${fmtTok(totals.completionTokens)} · Σ ${fmtTok(totals.totalTokens)}</div>
        <div class="history-table-wrap">
          <table class="history-table">
            <thead>
              <tr>
                <th>Time</th><th>Workflow</th><th>Model</th><th class="num">Sent</th><th class="num">Received</th><th class="num">Total</th><th>Host</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="7" class="empty-hint">No rows match the current filters.</td></tr>`}</tbody>
          </table>
        </div>`;
    }

    const clearControl = state.historyConfirmClear
      ? `
        <div class="hint">This permanently deletes all locally stored history. Continue?</div>
        <div class="btn-row">
          <button class="btn danger" id="history-clear-confirm">Yes, clear history</button>
          <button class="btn secondary" id="history-clear-cancel">Cancel</button>
        </div>`
      : `<div class="btn-row">
          <button class="btn secondary" id="history-download-btn" ${loading || filtered.length === 0 ? 'disabled' : ''} title="Downloads the currently filtered rows as CSV">Download CSV</button>
          <button class="btn secondary" id="history-clear-btn" ${loading || allEntries.length === 0 ? 'disabled' : ''}>Clear History</button>
        </div>`;

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>Token Usage History</h2>
        <button class="icon-btn" id="history-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        ${bodyHtml}
        ${clearControl}
      </div>
    `;

    document.getElementById('history-close').addEventListener('click', closeHistory);
    if (!loading && allEntries.length > 0) {
      wireHistoryFilters();
    }

    const downloadBtn = document.getElementById('history-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        post({ type: 'exportTokenHistoryCsv', entries: filtered });
      });
    }

    const clearBtn = document.getElementById('history-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.historyConfirmClear = true;
        renderHistory();
      });
    }
    const clearCancel = document.getElementById('history-clear-cancel');
    if (clearCancel) {
      clearCancel.addEventListener('click', () => {
        state.historyConfirmClear = false;
        renderHistory();
      });
    }
    const clearConfirm = document.getElementById('history-clear-confirm');
    if (clearConfirm) {
      clearConfirm.addEventListener('click', () => {
        state.historyConfirmClear = false;
        post({ type: 'clearTokenHistory' });
      });
    }
  }

  // ---------------- Message handling from extension ----------------
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        state.workflows = msg.workflows;
        state.workflowId = msg.defaultWorkflow || (msg.workflows[0] && msg.workflows[0].id);
        state.wizards = msg.wizards;
        renderBody();
        break;

      case 'models':
        state.models = msg.models;
        if (!state.modelUid && msg.models.length) state.modelUid = msg.models[0].uid;
        if (msg.error) toast('warn', msg.error);
        renderBody();
        if (state.settingsOpen) renderSettings();
        break;

      case 'files':
        state.skills = msg.skills;
        state.instructions = msg.instructions;
        state.prompts = msg.prompts;
        // Covers the case where the extension's *default* workflow is
        // already PROD Incident Analysis on first load -- 'init' sets
        // state.workflowId before this message (which carries the actual
        // Skill/Instruction/Prompt file lists) has arrived.
        ensureAutoSelectionForCurrentWorkflow();
        // Skills/Instructions/Custom Prompts now live in Settings only.
        if (state.settingsOpen) renderSettings();
        break;

      case 'promptContent':
        if (state.selectedPromptFile && state.selectedPromptFile.relativePath === msg.file.relativePath) {
          state.promptFileContent = msg.content;
          state.promptFileDirty = false;
          if (state.settingsOpen) renderSettings();
        }
        break;

      case 'managedFileContent':
        if (
          state.managedFileEditor &&
          state.managedFileEditor.kind === msg.kind &&
          state.managedFileEditor.file.relativePath === msg.file.relativePath
        ) {
          state.managedFileEditor.content = msg.content;
          state.managedFileEditor.dirty = false;
          if (state.settingsOpen) renderSettings();
        }
        break;

      case 'incidentSearchBusy':
        state.incidentSearch.busy = true;
        renderBody();
        break;

      case 'incidentSearchResult':
        state.incidentSearch.busy = false;
        state.incidentSearch.summary = { count: msg.count, query: msg.query };
        renderBody();
        break;

      case 'incidentSearchError':
        state.incidentSearch.busy = false;
        renderBody();
        toast('error', msg.message);
        break;

      case 'streamStart':
        // The request bubble + typing indicator already appeared
        // optimistically in onSend() the instant the user hit Send --
        // nothing to do here but confirm the streaming flag, since actual
        // model output only starts arriving via 'streamChunk' below.
        state.streaming = true;
        break;

      case 'promptTokenCounted':
        if (msg.requestId === state.requestId) {
          state.pendingPromptTokens = msg.promptTokens;
          renderTokenFooter();
        }
        break;

      case 'streamChunk': {
        const entry = state.chatEntries.find((e) => e.id === msg.requestId);
        if (!entry) break;
        const wasWaitingForFirstToken = entry.responseText.length === 0;
        entry.responseText += msg.text;
        if (wasWaitingForFirstToken) {
          // Structural change (typing-dots -> an actual bubble element):
          // needs one real re-render. Every chunk after this one is a
          // plain textContent update below, so per-token cost stays flat
          // regardless of how long the thread has grown.
          renderBody();
        } else {
          const bubble = document.getElementById('response-bubble-' + entry.id);
          if (bubble) bubble.textContent = entry.responseText;
        }
        scrollChatToBottom();
        break;
      }

      case 'streamDone': {
        const entry = state.chatEntries.find((e) => e.id === msg.requestId);
        if (entry) {
          entry.streaming = false;
          entry.contextSummary = msg.contextSummary;
        }
        if (msg.requestId === state.requestId) {
          state.streaming = false;
          state.lastUsage = msg.usage;
          state.pendingPromptTokens = null;
          state.tokenSession = msg.session;
        }
        if (isJiraWorkflow() && state.jiraWizard.pendingRequestId === msg.requestId) {
          state.jiraWizard.pendingRequestId = null;
          pushJiraBotText('Feature file generated below. Enter the relative path of the folder where you want to save it (leave blank for the workspace root).');
          state.jiraWizard.step = 'savePath';
        }
        renderBody();
        renderTokenFooter();
        break;
      }

      case 'streamError': {
        const entry = state.chatEntries.find((e) => e.id === msg.requestId);
        if (entry) {
          entry.streaming = false;
          entry.error = msg.message;
        }
        if (msg.requestId === state.requestId) {
          state.streaming = false;
          state.pendingPromptTokens = null;
        }
        toast('error', msg.message);
        renderBody();
        renderTokenFooter();
        break;
      }

      case 'testConnectionResult':
        state.testConnBusy = false;
        state.testConnResult = msg.ok ? `Model: ${msg.model}\n\n${msg.response}` : `Error: ${msg.error}`;
        state.testConnUsage = msg.ok ? msg.usage || null : null;
        if (!msg.ok) toast('error', msg.error);
        renderSettings();
        break;

      case 'tokenSession':
        state.tokenSession = msg.session;
        renderTokenFooter();
        break;

      case 'tokenHistory':
        state.historyEntries = msg.entries;
        state.historyConfirmClear = false;
        if (state.historyOpen) renderHistory();
        break;

      case 'wizardSaved':
        toast('info', `Saved ${msg.kind} to ${msg.relativePath}`);
        closeWizard();
        break;

      case 'wizardError':
        toast('error', msg.message);
        break;

      case 'fileParsing':
        state.fileParsing = true;
        renderBody();
        break;

      case 'fileAttached':
        state.fileParsing = false;
        state.attachedFile = { meta: msg.meta, preview: msg.preview };
        state.fileSelectionDraft = {};
        renderBody();
        scheduleContextEstimate();
        if (msg.meta.warning) toast('warn', msg.meta.warning);
        break;

      case 'fileSelectionUpdated':
        if (state.attachedFile) {
          state.attachedFile = { ...state.attachedFile, preview: msg.preview };
          renderBody();
        }
        break;

      case 'fileAttachError':
        state.fileParsing = false;
        renderBody();
        toast('error', msg.message);
        break;

      case 'fileCleared':
        state.attachedFile = null;
        state.contextMeter = null;
        state.fileParsing = false; // also covers: user cancelled the Browse dialog
        renderBody();
        break;

      case 'contextMeter':
        state.contextMeter = { usedTokens: msg.usedTokens, maxTokens: msg.maxTokens, exceeded: msg.exceeded, lastLineIncluded: msg.lastLineIncluded };
        // Targeted DOM update, not renderBody() -- see updateContextMeterDom().
        updateContextMeterDom();
        break;

      case 'jiraTicketFetched': {
        state.jiraWizard.ticketKey = msg.ticketKey;
        state.jiraWizard.ticketSummary = msg.summary;
        state.jiraWizard.chunks = msg.chunks;
        state.jiraWizard.selectedChunkIds = new Set(msg.chunks.map((c) => c.id));

        const acCount = msg.chunks.filter((c) => c.kind === 'ac').length;
        const linkedCount = msg.chunks.filter((c) => c.kind === 'linked-ticket').length;
        const attachmentCount = msg.chunks.filter((c) => c.kind === 'attachment').length;
        const bits = [msg.summary, `${acCount} Acceptance Criteria segment${acCount === 1 ? '' : 's'} found`];
        if (linkedCount) bits.push(`${linkedCount} linked ticket(s) included`);
        if (attachmentCount) bits.push(`${attachmentCount} attachment(s) parsed`);
        pushJiraBotText(bits.join(' -- '));
        pushJiraBotOptions('Ready when you are.', [
          { label: '📤 Send data to LLM for feature file generation', value: 'send' },
        ]);
        state.jiraWizard.step = 'ready';
        renderBody();
        scheduleContextEstimate();
        break;
      }

      case 'jiraTicketError':
        pushJiraBotText(`Could not fetch that ticket: ${msg.message} Enter a different URL/ticket key to try again.`);
        state.jiraWizard.step = 'ticketUrl';
        renderBody();
        break;

      case 'jiraChunkContentUpdated': {
        const changedChunk = state.jiraWizard.chunks.find((c) => c.id === msg.chunkId);
        if (changedChunk) changedChunk.charCount = msg.charCount;
        if (state.jiraWizard.controlPanelOpen) renderControlPanel();
        scheduleContextEstimate();
        break;
      }

      case 'featureFileSaved':
        pushJiraBotText(`Saved to ${msg.path} and opened it in the editor.`);
        pushJiraBotOptions('What next?', [{ label: '🔁 Analyze another ticket', value: 'newSearch' }]);
        state.jiraWizard.step = 'done';
        renderBody();
        break;

      case 'featureFileSaveError':
        pushJiraBotText(`Could not save the file: ${msg.message} Enter a different relative path.`);
        state.jiraWizard.step = 'savePath';
        renderBody();
        break;

      case 'toast':
        toast(msg.level, msg.message);
        break;
    }
  });

  renderRoot();
  post({ type: 'ready' });
})();
