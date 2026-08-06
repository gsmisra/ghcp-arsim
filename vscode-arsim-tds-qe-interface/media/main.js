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
    responseText: '', // accumulates across the whole session -- new responses are appended, not replaced
    responseCount: 0,
    contextSummary: null,
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
    collapsed: { workflow: true, request: true, response: true, tokenUsage: true },
    responseExpanded: false,
    promptEditorExpanded: false,
    historyFilters: { workflow: '', model: '', host: '', dateFrom: '', dateTo: '', search: '' },
    // ---- File attach ----
    fileParsing: false,
    attachedFile: null, // { meta, preview } once a file has been picked and parsed
    controlPanelOpen: false,
    fileSelectionDraft: {}, // working copy of FileSelection edited in the Control panel, applied on "Apply Selection"
    contextMeter: null, // { usedTokens, maxTokens, exceeded, lastLineIncluded }
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
      <div class="token-footer-row" data-toggle="tokenUsage" id="token-footer-toggle">
        <span class="token-footer-title">${tokenIcon()} Token Usage</span>
        <span class="chevron">${chevronIcon()}</span>
      </div>
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

    document.getElementById('token-footer-toggle').addEventListener('click', () => {
      state.collapsed.tokenUsage = !state.collapsed.tokenUsage;
      renderTokenFooter();
    });
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
  function renderBody() {
    const body = document.getElementById('body');
    body.innerHTML = `
      ${cardHtml('workflow', 'Workflow', 0, workflowCardBodyHtml())}
      ${cardHtml('request', 'Your Request', 0, requestCardBodyHtml())}
      ${cardHtml('response', 'Response', state.responseCount || 0, responseCardBodyHtml())}
    `;
    wireBody();
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

  function chevronIcon() {
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4"/></svg>`;
  }

  function copyIcon() {
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1"/></svg>`;
  }

  /** navigator.clipboard.writeText works in VS Code webviews (Chromium) on
   *  a user gesture; the execCommand fallback covers any restricted
   *  environment where the async Clipboard API is unavailable. */
  function copyResponseToClipboard() {
    if (!state.responseText) return;
    const text = state.responseText;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('info', 'Response copied to clipboard.');
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
    const activeModel = state.models.find((m) => m.uid === state.modelUid);

    return `
      <div class="field">
        <label class="field-label">Workflow to perform</label>
        <select id="workflow-select">${options}</select>
        ${active ? `<span class="hint">${esc(active.description)}</span>` : ''}
      </div>
      <div class="hint">Model: ${activeModel ? esc(activeModel.name) : 'none selected'} <button class="link-btn" id="open-settings-for-model">(change in Settings)</button></div>
    `;
  }

  function skillsBodyHtml() {
    return fileChecklistHtml(state.skills, state.selectedSkills, 'skill', 'No skill files found in .github/skills/.');
  }
  function instructionsBodyHtml() {
    return fileChecklistHtml(state.instructions, state.selectedInstructions, 'instruction', 'No instruction files found in .github/instructions/.');
  }

  function fileChecklistHtml(files, selectedSet, kind, emptyText) {
    if (!files.length) {
      return `<div class="empty-hint">${esc(emptyText)}</div>`;
    }
    const rows = files
      .map(
        (f) => `
        <label class="check-row">
          <input type="checkbox" data-kind="${kind}" data-path="${esc(f.relativePath)}" ${selectedSet.has(f.relativePath) ? 'checked' : ''} />
          <span title="${esc(f.relativePath)}">${esc(f.fileName)}</span>
        </label>`
      )
      .join('');
    return `<div class="checklist">${rows}</div>`;
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

  function requestCardBodyHtml() {
    return `
      <div class="field">
        <textarea id="user-text" placeholder="${esc(placeholderForWorkflow())}" style="min-height:96px;">${esc(state.userText)}</textarea>
        ${attachedFileRowHtml()}
      </div>
      ${contextMeterHtml()}
      <div class="btn-row">
        <button class="btn block" id="send-btn" ${state.streaming ? 'disabled' : ''}>${state.streaming ? 'Sending…' : 'Send to Copilot'}${state.streaming ? '<span class="streaming-dot"></span>' : ''}</button>
      </div>
    `;
  }

  function responseCardBodyHtml() {
    const responseClasses = 'response-panel' + (state.responseText ? '' : ' empty') + (state.responseExpanded ? ' expanded' : '');
    const summary = state.contextSummary;
    const statusText = state.streaming
      ? 'Streaming…'
      : state.responseCount
      ? `${state.responseCount} response${state.responseCount === 1 ? '' : 's'} this session`
      : 'No response yet';
    return `
      <div class="field">
        <div class="field-label-row">
          <span class="hint">${statusText}</span>
          <span class="response-controls">
            <button class="icon-btn small" id="copy-response-btn" title="Copy all response text" aria-label="Copy response" ${state.responseText ? '' : 'disabled'}>${copyIcon()}</button>
            <button class="link-btn" id="response-expand-btn">${state.responseExpanded ? 'Collapse ↑' : 'Expand ↓'}</button>
          </span>
        </div>
        <div class="${responseClasses}" data-placeholder="Copilot's responses will appear here and stay until you close VS Code.">${esc(state.responseText)}</div>
      </div>
      ${summary ? contextSummaryHtml(summary) : ''}
    `;
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
      return `<div class="btn-row"><button class="btn secondary" id="browse-btn">Browse…</button></div>`;
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
    const w = state.workflows.find((x) => x.id === state.workflowId);
    return w ? w.inputPlaceholder : 'Describe your request...';
  }

  // ---------------- Wiring: main body ----------------
  function wireBody() {
    document.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-toggle');
        state.collapsed[id] = !state.collapsed[id];
        renderBody();
      });
    });

    const responseExpandBtn = document.getElementById('response-expand-btn');
    if (responseExpandBtn) {
      responseExpandBtn.addEventListener('click', () => {
        state.responseExpanded = !state.responseExpanded;
        renderBody();
      });
    }

    const workflowSelect = document.getElementById('workflow-select');
    if (workflowSelect) {
      workflowSelect.addEventListener('change', (e) => {
        state.workflowId = e.target.value;
        renderBody();
        scheduleContextEstimate();
      });
    }

    const openSettingsForModel = document.getElementById('open-settings-for-model');
    if (openSettingsForModel) {
      openSettingsForModel.addEventListener('click', () => {
        state.settingsOpen = true;
        renderSettings();
      });
    }

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

    // Both links can be present at once (the attached-file row's link, and
    // the exceeded-context warning's link) -- wire each independently.
    ['control-context-link', 'control-context-link-warning'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', openControlPanel);
    });

    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', onSend);
    }
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
      });
    }, 500);
  }

  function onSend() {
    if (state.streaming) return;
    if (!state.userText.trim()) {
      toast('warn', 'Enter a request before sending.');
      return;
    }
    if (!state.modelUid) {
      toast('warn', 'Select a Copilot model first.');
      return;
    }
    state.streaming = true;
    state.collapsed.response = false; // reveal the response card so the user can watch it stream
    // responseText is intentionally NOT cleared here -- responses accumulate
    // for the whole session (see the 'streamStart' handler, which appends a
    // divider before this response's text starts arriving).
    state.contextSummary = null;
    state.lastUsage = null;
    state.pendingPromptTokens = null;
    state.requestId = uid();
    renderBody();
    renderTokenFooter();

    post({
      type: 'sendPrompt',
      requestId: state.requestId,
      workflowId: state.workflowId,
      modelUid: state.modelUid,
      userText: state.userText,
      selectedSkills: state.skills.filter((s) => state.selectedSkills.has(s.relativePath)),
      selectedInstructions: state.instructions.filter((i) => state.selectedInstructions.has(i.relativePath)),
      selectedPromptFile: state.selectedPromptFile,
      attachedFileId: state.attachedFile ? state.attachedFile.meta.fileId : null,
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
        <div class="settings-section">
          <h3>Copilot Model</h3>
          <div class="field">
            <label class="field-label">Model used for sending requests and Test Connection</label>
            <select id="settings-model-select">${modelOptions}</select>
          </div>
        </div>
        <div class="settings-section">
          <h3>Skills ${state.selectedSkills.size ? `<span class="badge">${state.selectedSkills.size}</span>` : ''}</h3>
          ${skillsBodyHtml()}
        </div>
        <div class="settings-section">
          <h3>Instructions ${state.selectedInstructions.size ? `<span class="badge">${state.selectedInstructions.size}</span>` : ''}</h3>
          ${instructionsBodyHtml()}
        </div>
        <div class="settings-section">
          <h3>Custom Prompts ${state.selectedPromptFile ? '<span class="badge">1</span>' : ''}</h3>
          ${promptsBodyHtml()}
        </div>
        <div class="settings-section">
          <h3>Connection</h3>
          <div class="btn-row">
            <button class="btn" id="test-conn-btn" ${state.testConnBusy ? 'disabled' : ''}>${state.testConnBusy ? 'Testing…' : 'Test Connection'}</button>
          </div>
          <div class="hint">Sends the text "Who are you ?" to the model selected above and shows its reply below.</div>
          <div class="response-panel ${state.testConnResult ? '' : 'empty'}" data-placeholder="No test run yet.">${state.testConnResult ? esc(state.testConnResult) : ''}</div>
          ${state.testConnUsage ? `<div class="context-summary">Tokens — sent: ${fmtTok(state.testConnUsage.promptTokens)} · received: ${fmtTok(state.testConnUsage.completionTokens)} · total: ${fmtTok(state.testConnUsage.totalTokens)}</div>` : ''}
        </div>
        <div class="settings-section">
          <h3>Author Content</h3>
          <div class="btn-row" style="flex-direction:column; align-items:stretch;">
            <button class="btn secondary block" data-wizard="skill">Add New Skill</button>
            <button class="btn secondary block" data-wizard="instruction">Add New Instruction</button>
            <button class="btn secondary block" data-wizard="prompt">Add New Prompt</button>
          </div>
        </div>
      </div>
    `;

    wireSettings(overlay);
  }

  function wireSettings(overlay) {
    document.getElementById('settings-close').addEventListener('click', () => {
      state.settingsOpen = false;
      renderSettings();
    });

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

  function renderControlPanel() {
    const overlay = document.getElementById('control-overlay');
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
        <div class="hint">File: ${esc(meta.fileName)} (detected as ${esc(meta.kind.toUpperCase())})</div>
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

      case 'streamStart': {
        state.streaming = true;
        // Append, never replace: responses accumulate for the whole
        // session until VS Code (or this view) is closed. A divider marks
        // where each new exchange starts in the combined scrollback.
        const wf = state.workflows.find((w) => w.id === state.workflowId);
        const label = wf ? wf.label : 'Request';
        const stamp = new Date().toLocaleString();
        const divider = `${state.responseText ? '\n\n' : ''}───── ${stamp} · ${label} ─────\n\n`;
        state.responseText += divider;
        state.responseCount += 1;
        renderBody();
        break;
      }

      case 'promptTokenCounted':
        if (msg.requestId === state.requestId) {
          state.pendingPromptTokens = msg.promptTokens;
          renderTokenFooter();
        }
        break;

      case 'streamChunk':
        if (msg.requestId === state.requestId) {
          state.responseText += msg.text;
          const panel = document.querySelector('.response-panel');
          if (panel) {
            panel.textContent = state.responseText;
            panel.classList.remove('empty');
            panel.scrollTop = panel.scrollHeight;
          }
        }
        break;

      case 'streamDone':
        if (msg.requestId === state.requestId) {
          state.streaming = false;
          state.contextSummary = msg.contextSummary;
          state.lastUsage = msg.usage;
          state.pendingPromptTokens = null;
          state.tokenSession = msg.session;
          renderBody();
          renderTokenFooter();
        }
        break;

      case 'streamError':
        if (msg.requestId === state.requestId) {
          state.streaming = false;
          state.pendingPromptTokens = null;
          toast('error', msg.message);
          renderBody();
          renderTokenFooter();
        }
        break;

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
