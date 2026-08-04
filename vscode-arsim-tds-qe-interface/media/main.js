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
    responseText: '',
    contextSummary: null,
    settingsOpen: false,
    wizard: null, // { kind, stepIndex, data }
    testConnBusy: false,
    testConnResult: null,
    requestId: null,
  };

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
    setTimeout(() => el.remove(), 4500);
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
      <div class="overlay" id="settings-overlay"></div>
      <div class="overlay" id="wizard-overlay"></div>
      <div class="toast-stack" id="toast-stack"></div>
    `;
    document.getElementById('settings-btn').addEventListener('click', () => {
      state.settingsOpen = true;
      renderSettings();
    });
    renderBody();
  }

  function gearIcon() {
    return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"/><path d="M13.2 8a5.2 5.2 0 0 0-.08-.9l1.3-1-1.2-2.1-1.53.5a5.3 5.3 0 0 0-1.55-.9L9.8 2h-3.6l-.34 1.6a5.3 5.3 0 0 0-1.55.9l-1.53-.5-1.2 2.1 1.3 1a5.3 5.3 0 0 0 0 1.8l-1.3 1 1.2 2.1 1.53-.5c.46.38.98.69 1.55.9L6.2 14h3.6l.34-1.6c.57-.21 1.09-.52 1.55-.9l1.53.5 1.2-2.1-1.3-1c.05-.3.08-.6.08-.9Z"/></svg>`;
  }

  // ---------------- Main body ----------------
  function renderBody() {
    const body = document.getElementById('body');
    body.innerHTML = `
      ${workflowCardHtml()}
      ${cardHtml('skills', 'Skills', state.selectedSkills.size, skillsBodyHtml())}
      ${cardHtml('instructions', 'Instructions', state.selectedInstructions.size, instructionsBodyHtml())}
      ${cardHtml('prompts', 'Custom Prompts', state.selectedPromptFile ? 1 : 0, promptsBodyHtml())}
      ${requestCardHtml()}
    `;
    wireBody();
  }

  function cardHtml(id, title, badgeCount, innerHtml) {
    return `
      <div class="card" id="card-${id}">
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

  function workflowCardHtml() {
    const options = state.workflows
      .map((w) => `<option value="${esc(w.id)}" ${w.id === state.workflowId ? 'selected' : ''}>${esc(w.label)}</option>`)
      .join('');
    const active = state.workflows.find((w) => w.id === state.workflowId);
    const modelOptions = state.models.length
      ? state.models.map((m) => `<option value="${esc(m.uid)}" ${m.uid === state.modelUid ? 'selected' : ''}>${esc(m.name)}${m.vendor ? ' (' + esc(m.vendor) + ')' : ''}</option>`).join('')
      : `<option value="">No models found</option>`;

    return `
      <div class="card">
        <div class="card-body" style="padding-top:12px;">
          <div class="field">
            <label class="field-label">Workflow to perform</label>
            <select id="workflow-select">${options}</select>
            ${active ? `<span class="hint">${esc(active.description)}</span>` : ''}
          </div>
          <div class="field">
            <label class="field-label">Copilot Model</label>
            <select id="model-select">${modelOptions}</select>
          </div>
        </div>
      </div>`;
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
          <label class="field-label">Prompt Content ${state.promptFileDirty ? '(unsaved changes)' : ''}</label>
          <textarea id="prompt-editor" style="min-height:120px;">${esc(state.promptFileContent)}</textarea>
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

  function requestCardHtml() {
    const responseClasses = 'response-panel' + (state.responseText ? '' : ' empty');
    const summary = state.contextSummary;
    return `
      <div class="card">
        <div class="card-body" style="padding-top:12px;">
          <div class="field">
            <label class="field-label">Your Request</label>
            <textarea id="user-text" placeholder="${esc(placeholderForWorkflow())}" style="min-height:96px;">${esc(state.userText)}</textarea>
          </div>
          <div class="btn-row">
            <button class="btn block" id="send-btn" ${state.streaming ? 'disabled' : ''}>${state.streaming ? 'Sending…' : 'Send to Copilot'}${state.streaming ? '<span class="streaming-dot"></span>' : ''}</button>
          </div>
          <div class="field">
            <label class="field-label">Response</label>
            <div class="${responseClasses}" data-placeholder="Copilot's response will appear here.">${esc(state.responseText)}</div>
          </div>
          ${summary ? contextSummaryHtml(summary) : ''}
        </div>
      </div>`;
  }

  function contextSummaryHtml(s) {
    const parts = [
      `Model: ${esc(s.modelName)}`,
      `Workflow: ${esc(s.workflowLabel)}`,
      `Skills included: ${s.skillsIncluded}`,
      `Instructions included: ${s.instructionsIncluded}`,
      `Prompt file used: ${s.usedPromptFile ? 'yes' : 'no'}`,
      `Context sent: ~${s.approxCharsSent.toLocaleString()} chars`,
    ];
    const trunc = s.truncatedFiles && s.truncatedFiles.length
      ? `<br/>Truncated: ${s.truncatedFiles.map(esc).join('; ')}`
      : '';
    return `<div class="context-summary">${parts.join(' · ')}${trunc}</div>`;
  }

  function placeholderForWorkflow() {
    const w = state.workflows.find((x) => x.id === state.workflowId);
    return w ? w.inputPlaceholder : 'Describe your request...';
  }

  // ---------------- Wiring: main body ----------------
  function wireBody() {
    document.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        el.closest('.card').classList.toggle('collapsed');
      });
    });

    const workflowSelect = document.getElementById('workflow-select');
    if (workflowSelect) {
      workflowSelect.addEventListener('change', (e) => {
        state.workflowId = e.target.value;
        renderBody();
      });
    }

    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', (e) => {
        state.modelUid = e.target.value;
      });
    }

    document.querySelectorAll('input[type=checkbox][data-kind]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const path = e.target.getAttribute('data-path');
        const kind = e.target.getAttribute('data-kind');
        const set = kind === 'skill' ? state.selectedSkills : state.selectedInstructions;
        if (e.target.checked) set.add(path);
        else set.delete(path);
        renderBody();
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
          renderBody();
          return;
        }
        const file = state.prompts.find((p) => p.relativePath === path);
        state.selectedPromptFile = file || null;
        state.promptFileDirty = false;
        if (file) post({ type: 'loadPrompt', file });
        renderBody();
      });
    }

    const promptEditor = document.getElementById('prompt-editor');
    if (promptEditor) {
      promptEditor.addEventListener('input', (e) => {
        state.promptFileContent = e.target.value;
        state.promptFileDirty = true;
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

    const userText = document.getElementById('user-text');
    if (userText) {
      userText.addEventListener('input', (e) => {
        state.userText = e.target.value;
      });
    }

    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', onSend);
    }
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
    state.responseText = '';
    state.contextSummary = null;
    state.requestId = uid();
    renderBody();

    post({
      type: 'sendPrompt',
      requestId: state.requestId,
      workflowId: state.workflowId,
      modelUid: state.modelUid,
      userText: state.userText,
      selectedSkills: state.skills.filter((s) => state.selectedSkills.has(s.relativePath)),
      selectedInstructions: state.instructions.filter((i) => state.selectedInstructions.has(i.relativePath)),
      selectedPromptFile: state.selectedPromptFile,
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
      ? state.models.map((m) => `<option value="${esc(m.uid)}" ${m.uid === state.modelUid ? 'selected' : ''}>${esc(m.name)}</option>`).join('')
      : `<option value="">No models found</option>`;

    overlay.innerHTML = `
      <div class="overlay-header">
        <h2>Settings</h2>
        <button class="icon-btn" id="settings-close" aria-label="Close">${closeIcon()}</button>
      </div>
      <div class="overlay-body">
        <div class="settings-section">
          <h3>Connection</h3>
          <div class="field">
            <label class="field-label">Model to test</label>
            <select id="settings-model-select">${modelOptions}</select>
          </div>
          <div class="btn-row">
            <button class="btn" id="test-conn-btn" ${state.testConnBusy ? 'disabled' : ''}>${state.testConnBusy ? 'Testing…' : 'Test Connection'}</button>
          </div>
          <div class="hint">Sends the text "Who are you ?" to the selected model and shows its reply below.</div>
          <div class="response-panel ${state.testConnResult ? '' : 'empty'}" data-placeholder="No test run yet.">${state.testConnResult ? esc(state.testConnResult) : ''}</div>
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

    document.getElementById('settings-close').addEventListener('click', () => {
      state.settingsOpen = false;
      renderSettings();
    });
    document.getElementById('settings-model-select').addEventListener('change', (e) => {
      state.modelUid = e.target.value;
      renderBody();
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
        renderBody();
        break;

      case 'promptContent':
        if (state.selectedPromptFile && state.selectedPromptFile.relativePath === msg.file.relativePath) {
          state.promptFileContent = msg.content;
          state.promptFileDirty = false;
          renderBody();
        }
        break;

      case 'streamStart':
        state.streaming = true;
        state.responseText = '';
        renderBody();
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
          renderBody();
        }
        break;

      case 'streamError':
        if (msg.requestId === state.requestId) {
          state.streaming = false;
          toast('error', msg.message);
          renderBody();
        }
        break;

      case 'testConnectionResult':
        state.testConnBusy = false;
        state.testConnResult = msg.ok ? `Model: ${msg.model}\n\n${msg.response}` : `Error: ${msg.error}`;
        if (!msg.ok) toast('error', msg.error);
        renderSettings();
        break;

      case 'wizardSaved':
        toast('info', `Saved ${msg.kind} to ${msg.relativePath}`);
        closeWizard();
        break;

      case 'wizardError':
        toast('error', msg.message);
        break;

      case 'toast':
        toast(msg.level, msg.message);
        break;
    }
  });

  renderRoot();
  post({ type: 'ready' });
})();
