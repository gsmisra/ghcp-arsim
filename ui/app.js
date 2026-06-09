const actionTypeEl = document.getElementById('actionType');
const actionNoticeEl = document.getElementById('actionNotice');
const testCaseFieldsEl = document.getElementById('testCaseFields');
const sourceEl = document.getElementById('source');
const outputFormatEl = document.getElementById('outputFormat');
const urlGroup = document.getElementById('urlGroup');
const sourceUrlEl = document.getElementById('sourceUrl');
const authGroup = document.getElementById('authGroup');
const apiUsernameEl = document.getElementById('apiUsername');
const apiPasswordEl = document.getElementById('apiPassword');
const uploadGroup = document.getElementById('uploadGroup');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const generateBtn = document.getElementById('generateBtn');
const resultSection = document.getElementById('resultSection');
const resultBox = document.getElementById('resultBox');
const outputActions = document.getElementById('outputActions');
const generatedFilesEl = document.getElementById('generatedFiles');
const previewBtn = document.getElementById('previewBtn');
const downloadBtn = document.getElementById('downloadBtn');
const previewBox = document.getElementById('previewBox');
const menuToggleBtn = document.getElementById('menuToggleBtn');
const menuPanel = document.getElementById('menuPanel');
const addSkillBtn = document.getElementById('addSkillBtn');
const addInstructionBtn = document.getElementById('addInstructionBtn');
const devDocsBtn = document.getElementById('devDocsBtn');
const referenceLogEl = document.getElementById('referenceLog');
const ghcpPanelEl = document.getElementById('ghcpPanel');
const bridgeStatusEl = document.getElementById('bridgeStatus');
const ghcpPromptEl = document.getElementById('ghcpPrompt');
const savePromptBtn = document.getElementById('savePromptBtn');
const previewSourceBtn = document.getElementById('previewSourceBtn');
const savedPromptSelectEl = document.getElementById('savedPromptSelect');
const ghcpSourceContextEl = document.getElementById('ghcpSourceContext');
const sourcePreviewBoxEl = document.getElementById('sourcePreviewBox');
const documentScopeEl = document.getElementById('documentScope');
const pageStartEl = document.getElementById('pageStart');
const pageEndEl = document.getElementById('pageEnd');
const rowStartEl = document.getElementById('rowStart');
const rowEndEl = document.getElementById('rowEnd');
const excelTabsWrapEl = document.getElementById('excelTabsWrap');
const excelSheetsSelectEl = document.getElementById('excelSheetsSelect');
const skillsSelectionListEl = document.getElementById('skillsSelectionList');
const instructionsSelectionListEl = document.getElementById('instructionsSelectionList');
const wizardOverlay = document.getElementById('wizardOverlay');
const wizardTitle = document.getElementById('wizardTitle');
const wizardStepMeta = document.getElementById('wizardStepMeta');
const wizardPrompt = document.getElementById('wizardPrompt');
const wizardLabel = document.getElementById('wizardLabel');
const wizardInput = document.getElementById('wizardInput');
const wizardHint = document.getElementById('wizardHint');
const wizardSample = document.getElementById('wizardSample');
const wizardSummary = document.getElementById('wizardSummary');
const wizardPreview = document.getElementById('wizardPreview');
const wizardNextBtn = document.getElementById('wizardNextBtn');
const wizardSubmitBtn = document.getElementById('wizardSubmitBtn');
const closeWizardBtn = document.getElementById('closeWizardBtn');
const appConfig = window.APP_CONFIG || {};

let generatedFiles = [];
let wizardState = null;
let latestGhcpPayload = null;
let latestGhcpArtifact = null;
let bridgeHealthRetryTimer = null;
let previewState = {
  fingerprint: '',
  isApplyingPreview: false,
};

function autoResizeSourcePreview() {
  sourcePreviewBoxEl.style.height = 'auto';
  const maxHeight = Math.floor(window.innerHeight * 0.7);
  sourcePreviewBoxEl.style.height = `${Math.min(sourcePreviewBoxEl.scrollHeight, maxHeight)}px`;
}

function resetDocumentScopeInputs() {
  pageStartEl.value = '';
  pageEndEl.value = '';
  rowStartEl.value = '';
  rowEndEl.value = '';
  excelSheetsSelectEl.innerHTML = '';
  excelTabsWrapEl.hidden = true;
  previewState.fingerprint = '';
}

const wizardDefinitions = {
  skill: {
    title: 'Add new skill',
    submitRoute: () => appConfig.createSkillRoute || '/api/skills/create',
    steps: [
      { key: 'file_name', label: 'Skill file name', required: true, multiline: false, prompt: 'Enter the skill file name.', hint: 'Required. .md is auto-added if omitted. Example: api-regression-skill' },
      { key: 'title', label: 'Skill title', required: true, multiline: false, prompt: 'Enter a clear title for this skill.', hint: 'Required. Example: API Regression Test Case Generation' },
      { key: 'purpose', label: 'Purpose', required: true, multiline: true, prompt: 'Describe the purpose and expected outcome of this skill.', hint: 'Required. You can type multiple lines. Press Ctrl+Enter to continue.' },
      { key: 'scope', label: 'Scope', required: false, multiline: true, prompt: 'Describe scope boundaries (in/out of scope).', hint: 'Optional. Leave blank to skip.' },
      { key: 'business_context', label: 'Business context', required: false, multiline: true, prompt: 'Describe the business domain context.', hint: 'Optional. Leave blank to skip.' },
      { key: 'inputs', label: 'Inputs', required: false, multiline: true, prompt: 'List the main inputs this skill expects.', hint: 'Optional. Include source systems, formats, and constraints.' },
      { key: 'preconditions', label: 'Preconditions', required: false, multiline: true, prompt: 'List prerequisites before this skill can run.', hint: 'Optional. Leave blank to skip.' },
      { key: 'actions', label: 'Actions', required: false, multiline: true, prompt: 'Describe the steps this skill performs.', hint: 'Optional. Leave blank to skip.' },
      { key: 'rules', label: 'Rules and validations', required: false, multiline: true, prompt: 'List business/technical rules and validation checks.', hint: 'Optional. Leave blank to skip.' },
      { key: 'outputs', label: 'Outputs', required: false, multiline: true, prompt: 'Describe outputs and deliverables.', hint: 'Optional. Leave blank to skip.' },
      { key: 'dependencies', label: 'Dependencies', required: false, multiline: true, prompt: 'List dependent services, tools, or files.', hint: 'Optional. Leave blank to skip.' },
      { key: 'limitations', label: 'Limitations', required: false, multiline: true, prompt: 'List known limitations or exclusions.', hint: 'Optional. Leave blank to skip.' },
      { key: 'owner', label: 'Owner', required: false, multiline: false, prompt: 'Who owns this skill?', hint: 'Optional. Team or individual name.' },
      { key: 'reviewers', label: 'Reviewers', required: false, multiline: false, prompt: 'Who reviews changes for this skill?', hint: 'Optional. Comma-separated names/teams.' },
      { key: 'version', label: 'Version', required: false, multiline: false, prompt: 'Enter skill version.', hint: 'Optional. Example: 1.0.0' },
      { key: 'tags', label: 'Tags', required: false, multiline: false, prompt: 'Add searchable tags.', hint: 'Optional. Example: qe,api,regression,banking' },
      { key: 'examples', label: 'Examples', required: false, multiline: true, prompt: 'Add usage examples.', hint: 'Optional. Leave blank to skip.' },
      { key: 'success_metrics', label: 'Success metrics', required: false, multiline: true, prompt: 'Define measurable success metrics.', hint: 'Optional. Leave blank to skip.' },
    ],
  },
  instruction: {
    title: 'Add new Instruction',
    submitRoute: () => appConfig.createInstructionRoute || '/api/instructions/create',
    steps: [
      { key: 'file_name', label: 'Instruction file name', required: true, multiline: false, prompt: 'Enter the instruction file name.', hint: 'Required. .md is auto-added if omitted. Example: release-readiness-instructions' },
      { key: 'title', label: 'Instruction title', required: true, multiline: false, prompt: 'Enter a clear instruction title.', hint: 'Required. Example: QE Release Readiness Checklist' },
      { key: 'objective', label: 'Objective', required: true, multiline: true, prompt: 'Describe what this instruction should achieve.', hint: 'Required. You can type multiple lines. Press Ctrl+Enter to continue.' },
      { key: 'audience', label: 'Audience', required: false, multiline: false, prompt: 'Who is this instruction for?', hint: 'Optional. Example: QE analysts, automation engineers.' },
      { key: 'prerequisites', label: 'Prerequisites', required: false, multiline: true, prompt: 'List prerequisites before execution.', hint: 'Optional. Leave blank to skip.' },
      { key: 'inputs', label: 'Inputs', required: false, multiline: true, prompt: 'List required inputs, artifacts, or data.', hint: 'Optional. Leave blank to skip.' },
      { key: 'steps', label: 'Steps', required: true, multiline: true, prompt: 'Enter the detailed execution steps.', hint: 'Required. Multi-line supported; keep one instruction per line if possible.' },
      { key: 'validation', label: 'Validation and acceptance', required: false, multiline: true, prompt: 'Describe how success is validated.', hint: 'Optional. Leave blank to skip.' },
      { key: 'rollback', label: 'Rollback/contingency', required: false, multiline: true, prompt: 'Add fallback actions if execution fails.', hint: 'Optional. Leave blank to skip.' },
      { key: 'references', label: 'References', required: false, multiline: true, prompt: 'Link related docs, dashboards, or runbooks.', hint: 'Optional. Leave blank to skip.' },
      { key: 'notes', label: 'Notes', required: false, multiline: true, prompt: 'Add notes, constraints, reminders, or approvals.', hint: 'Optional. Leave blank to skip.' },
      { key: 'owner', label: 'Owner', required: false, multiline: false, prompt: 'Who owns this instruction?', hint: 'Optional. Team or individual name.' },
      { key: 'approvers', label: 'Approvers', required: false, multiline: false, prompt: 'Who approves this process?', hint: 'Optional. Comma-separated names/teams.' },
      { key: 'frequency', label: 'Frequency', required: false, multiline: false, prompt: 'How often is this run?', hint: 'Optional. Example: per release / weekly.' },
      { key: 'sla', label: 'SLA/target timeline', required: false, multiline: false, prompt: 'Any timeline or SLA target?', hint: 'Optional. Example: Complete in 2 hours.' },
      { key: 'risks', label: 'Risks', required: false, multiline: true, prompt: 'List key risks and mitigations.', hint: 'Optional. Leave blank to skip.' },
      { key: 'tags', label: 'Tags', required: false, multiline: false, prompt: 'Add searchable tags.', hint: 'Optional. Example: release,checklist,qe' },
    ],
  },
};

const wizardSamplesByKey = {
  file_name: 'release-readiness-checklist',
  title: 'QE Release Readiness Checklist',
  purpose: '- Define the problem solved by this skill.\n- Explain expected outcomes.',
  objective: '- Ensure quality gates are complete before release.',
  scope: '- In scope: release verification\n- Out of scope: production hotfix execution',
  business_context: 'Supports retail banking web + mobile release governance.',
  audience: 'QE Analysts, QE Automation Engineers, Release Managers',
  inputs: '- Jira epic IDs\n- Build artifact link\n- Regression suite results',
  preconditions: '- Access to Jira and CI pipeline\n- Latest deployment build available',
  prerequisites: '- Confirm release candidate is tagged\n- Confirm environment is stable',
  actions: '1. Parse requirements\n2. Map risk areas\n3. Generate detailed scenarios',
  rules: '- Include positive and negative cases\n- Tag by domain and priority',
  outputs: '- BDD feature files\n- Jira CSV test cases\n- Traceability matrix',
  dependencies: '- Jira API\n- Confluence API\n- Internal risk catalogue',
  limitations: '- Does not execute tests\n- Requires source data quality',
  owner: 'QE Platform Team',
  reviewers: 'QE Lead, Risk QA Architect',
  approvers: 'Release Manager, QA Director',
  version: '1.0.0',
  tags: 'qe,release,banking,compliance',
  examples: 'Input: BRD document + Jira story IDs\nOutput: feature + csv artifacts',
  success_metrics: '- 95% requirement coverage\n- < 2% escaped defects from covered scope',
  steps: '1. Validate build health\n2. Run smoke suite\n3. Verify blocking defects\n4. Obtain sign-off',
  validation: '- All critical tests passed\n- No Sev1/Sev2 open defects',
  rollback: '- Revert deployment\n- Re-open release gate\n- Trigger incident process',
  references: '- Confluence runbook URL\n- Release dashboard URL',
  notes: '- Requires business sign-off for payment-impacting changes.',
  frequency: 'Per release',
  sla: 'Complete within 2 hours of RC publish',
  risks: '- Incomplete test data\n- Environment instability',
};

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeValue(value) {
  return normalizeLineEndings(value).trim();
}

function toPreviewMarkdownName(value, fallback) {
  const base = normalizeValue(value) || fallback;
  return /\.md$/i.test(base) ? base : `${base}.md`;
}

function toBulletBlock(value) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return '_Not provided._';
  }

  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
    .join('\n');
}

function getLiveWizardValues() {
  if (!wizardState) {
    return {};
  }

  const currentStep = wizardState.definition.steps[wizardState.index];
  const values = { ...wizardState.values };
  const currentValue = normalizeValue(wizardInput.value);
  if (currentValue) {
    values[currentStep.key] = currentValue;
  } else {
    delete values[currentStep.key];
  }
  return values;
}

function buildSkillPreviewMarkdown(values) {
  const read = (key) => toBulletBlock(values[key]);
  return [
    `# ${values.title || 'Skill title'}`,
    '',
    '## Purpose',
    read('purpose'),
    '',
    '## Scope',
    read('scope'),
    '',
    '## Business Context',
    read('business_context'),
    '',
    '## Inputs',
    read('inputs'),
    '',
    '## Preconditions',
    read('preconditions'),
    '',
    '## Actions',
    read('actions'),
    '',
    '## Rules and Validations',
    read('rules'),
    '',
    '## Outputs',
    read('outputs'),
    '',
    '## Dependencies',
    read('dependencies'),
    '',
    '## Limitations',
    read('limitations'),
    '',
    '## Ownership',
    `- Owner: ${values.owner || 'Not provided'}`,
    `- Reviewers: ${values.reviewers || 'Not provided'}`,
    `- Version: ${values.version || 'Not provided'}`,
    `- Tags: ${values.tags || 'Not provided'}`,
    `- File: ${toPreviewMarkdownName(values.file_name, 'skill-file')}`,
    '',
    '## Examples',
    read('examples'),
    '',
    '## Success Metrics',
    read('success_metrics'),
  ].join('\n');
}

function buildInstructionPreviewMarkdown(values) {
  const read = (key) => toBulletBlock(values[key]);
  return [
    `# ${values.title || 'Instruction title'}`,
    '',
    '## Objective',
    read('objective'),
    '',
    '## Audience',
    read('audience'),
    '',
    '## Prerequisites',
    read('prerequisites'),
    '',
    '## Inputs',
    read('inputs'),
    '',
    '## Steps',
    read('steps'),
    '',
    '## Validation and Acceptance',
    read('validation'),
    '',
    '## Rollback/Contingency',
    read('rollback'),
    '',
    '## References',
    read('references'),
    '',
    '## Notes',
    read('notes'),
    '',
    '## Risks',
    read('risks'),
    '',
    '## Governance',
    `- Owner: ${values.owner || 'Not provided'}`,
    `- Approvers: ${values.approvers || 'Not provided'}`,
    `- Frequency: ${values.frequency || 'Not provided'}`,
    `- SLA/Target timeline: ${values.sla || 'Not provided'}`,
    `- Tags: ${values.tags || 'Not provided'}`,
    `- File: ${toPreviewMarkdownName(values.file_name, 'instruction-file')}`,
  ].join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toColorizedMarkdownHtml(markdownText) {
  return normalizeLineEndings(markdownText)
    .split('\n')
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith('# ')) {
        return `<span class="md-h1">${escaped}</span>`;
      }
      if (line.startsWith('## ')) {
        return `<span class="md-h2">${escaped}</span>`;
      }
      if (line.startsWith('- ')) {
        return `<span class="md-bullet">${escaped}</span>`;
      }
      if (line.startsWith('_') && line.endsWith('_')) {
        return `<span class="md-muted">${escaped}</span>`;
      }
      return `<span class="md-text">${escaped}</span>`;
    })
    .join('<br>');
}

function renderWizardPreview(values) {
  if (!wizardState) {
    wizardPreview.textContent = 'Preview will appear here as markdown.';
    return;
  }

  const markdown = wizardState.type === 'skill'
    ? buildSkillPreviewMarkdown(values)
    : buildInstructionPreviewMarkdown(values);
  wizardPreview.innerHTML = toColorizedMarkdownHtml(markdown);
}

function getRequiredMissing(definition, values) {
  return definition.steps
    .filter((step) => step.required)
    .filter((step) => !String(values[step.key] || '').trim())
    .map((step) => step.label);
}

function renderWizardSummary() {
  if (!wizardState) {
    wizardSummary.textContent = 'No details captured yet.';
    wizardPreview.textContent = 'Preview will appear here as markdown.';
    return;
  }

  const liveValues = getLiveWizardValues();
  const lines = wizardState.definition.steps.map((step) => {
    const raw = String(liveValues[step.key] || '');
    const provided = raw.trim().length > 0;
    const mark = provided ? '[x]' : '[ ]';
    const req = step.required ? 'Required' : 'Optional';
    return `${mark} ${step.label} (${req})`;
  });
  wizardSummary.textContent = lines.join('\n');
  renderWizardPreview(liveValues);
}

function resetResults() {
  generatedFiles = [];
  resultSection.hidden = true;
  outputActions.hidden = true;
  generatedFilesEl.innerHTML = '';
  resultBox.textContent = 'No output generated yet.';
  previewBox.textContent = 'Select a generated file and click Preview File.';
}

function setBridgeStatus(text, state) {
  bridgeStatusEl.textContent = text;
  bridgeStatusEl.classList.remove('ok', 'warn', 'error');
  if (state) {
    bridgeStatusEl.classList.add(state);
  }
}

function updateSavePromptVisibility() {
  const hasPrompt = ghcpPromptEl.value.trim().length > 0;
  savePromptBtn.hidden = !hasPrompt;
}

function getSourceFormPayload() {
  const source = sourceEl.value;
  const output_format = outputFormatEl.value;
  const payload = { source, source_type: source, output_format };

  const selectedSkillNames = getSelectedReferenceValues(skillsSelectionListEl);
  const selectedInstructionNames = getSelectedReferenceValues(instructionsSelectionListEl);
  payload.selected_skills = selectedSkillNames;
  payload.selected_instructions = selectedInstructionNames;
  payload.parsed_override = sourcePreviewBoxEl.value.trim();

  if (source === 'document') {
    const file = fileInput.files[0];
    if (!file) {
      throw new Error('Please upload a document before sending source data to GHCP.');
    }
    payload.file = file;
    payload.prompt = ghcpPromptEl.value.trim() || 'Generate detailed BDD test cases only from the provided document content.';
    payload.source_context = ghcpSourceContextEl.value.trim();
    payload.page_start = pageStartEl.value.trim();
    payload.page_end = pageEndEl.value.trim();
    payload.row_start = rowStartEl.value.trim();
    payload.row_end = rowEndEl.value.trim();
    payload.sheet_names = Array.from(excelSheetsSelectEl.selectedOptions).map((item) => item.value).filter(Boolean);
    return payload;
  }

  const sourceValue = sourceUrlEl.value.trim();
  if (!sourceValue) {
    throw new Error('Please provide Confluence URL/page ID or Jira story IDs before sending source data to GHCP.');
  }

  payload.source_url = sourceValue;
  payload.prompt = ghcpPromptEl.value.trim() || 'Generate detailed BDD test cases only from the provided source content.';
  payload.source_context = ghcpSourceContextEl.value.trim();

  if (source === 'confluence') {
    payload.url = sourceValue;
    payload.username = apiUsernameEl.value.trim();
    payload.password = apiPasswordEl.value;
  } else {
    payload.story_ids = sourceValue;
    payload.username = apiUsernameEl.value.trim();
    payload.password = apiPasswordEl.value;
  }

  return payload;
}

function getDocumentPreviewFingerprint(payload) {
  if (!payload || payload.source !== 'document' || !payload.file) {
    return '';
  }

  return JSON.stringify({
    name: payload.file.name,
    size: payload.file.size,
    mtime: payload.file.lastModified,
    page_start: payload.page_start || '',
    page_end: payload.page_end || '',
    row_start: payload.row_start || '',
    row_end: payload.row_end || '',
    sheets: payload.sheet_names || [],
    selected_skills: payload.selected_skills || [],
    selected_instructions: payload.selected_instructions || [],
    source_context: payload.source_context || '',
  });
}

function getSelectedReferenceValues(container) {
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((item) => item.value);
}

function renderReferenceSelectionList(container, items, keyPrefix) {
  const previouslySelected = new Set(getSelectedReferenceValues(container));
  container.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'selection-empty';
    empty.textContent = 'No markdown files available.';
    container.appendChild(empty);
    return;
  }

  items.forEach((name, index) => {
    const id = `${keyPrefix}-${index}`;
    const row = document.createElement('label');
    row.className = 'selection-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.id = id;
    input.checked = previouslySelected.has(name);

    const text = document.createElement('span');
    text.textContent = name;

    row.appendChild(input);
    row.appendChild(text);
    container.appendChild(row);
  });
}

function renderReferenceLog(payload) {
  const skills = payload.skills || [];
  const instructions = payload.instructions || [];

  renderReferenceSelectionList(skillsSelectionListEl, skills, 'skill-ref');
  renderReferenceSelectionList(instructionsSelectionListEl, instructions, 'instruction-ref');

  const logText = [
    'Skills referenced on load:',
    ...(skills.length ? skills.map((item) => `- ${item}`) : ['- none']),
    '',
    'Instructions referenced on load:',
    ...(instructions.length ? instructions.map((item) => `- ${item}`) : ['- none']),
  ].join('\n');

  if (referenceLogEl) {
    referenceLogEl.textContent = logText;
  }
}

async function loadReferenceFiles() {
  const route = appConfig.referenceFilesRoute || '/api/reference-files';
  try {
    const response = await fetch(route);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load referenced files.');
    }
    renderReferenceLog(payload);
  } catch (error) {
    if (referenceLogEl) {
      referenceLogEl.textContent = `Error loading referenced files: ${error.message}`;
    }
  }
}

async function autoPreviewDocumentContent() {
  if (sourceEl.value !== 'document' || !fileInput.files[0]) {
    return;
  }

  sourcePreviewBoxEl.value = 'Building exact source payload preview...';
  autoResizeSourcePreview();
  await previewCurrentSourceContext();
  setBridgeStatus('Source preview prepared', 'ok');
}

async function loadSavedPrompts() {
  const route = appConfig.promptsListRoute || '/api/prompts';
  try {
    const response = await fetch(route);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load saved prompts.');
    }

    const keywords = payload.keywords || [];
    const current = savedPromptSelectEl.value;
    savedPromptSelectEl.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a saved prompt keyword';
    savedPromptSelectEl.appendChild(placeholder);

    keywords.forEach((keyword) => {
      const option = document.createElement('option');
      option.value = keyword;
      option.textContent = keyword;
      savedPromptSelectEl.appendChild(option);
    });

    if (current && keywords.includes(current)) {
      savedPromptSelectEl.value = current;
    }
  } catch (error) {
    setBridgeStatus(`Prompt list error: ${error.message}`, 'warn');
  }
}

async function savePromptWithKeyword() {
  const promptText = ghcpPromptEl.value.trim();
  if (!promptText) {
    throw new Error('Enter a prompt before saving.');
  }

  const keyword = (window.prompt('Enter keyword for this prompt:') || '').trim();
  if (!keyword) {
    throw new Error('Prompt keyword is required to save.');
  }

  const route = appConfig.promptsSaveRoute || '/api/prompts/save';
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword,
      prompt_text: promptText,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to save prompt.');
  }

  await loadSavedPrompts();
  savedPromptSelectEl.value = payload.keyword;
}

async function loadPromptByKeyword(keyword) {
  if (!keyword) {
    return;
  }

  const route = appConfig.promptsGetRoute || '/api/prompts/get';
  const response = await fetch(`${route}?keyword=${encodeURIComponent(keyword)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load saved prompt.');
  }

  ghcpPromptEl.value = payload.prompt_text || '';
  updateSavePromptVisibility();
}

async function checkBridgeHealth() {
  const route = appConfig.ghcpBridgeHealthRoute || '/api/ghcp/health';
  try {
    const response = await fetch(route);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Bridge health check failed.');
    }
    setBridgeStatus(`Bridge OK on ${payload.bridge_url || 'local bridge'}`, 'ok');
    if (bridgeHealthRetryTimer) {
      clearInterval(bridgeHealthRetryTimer);
      bridgeHealthRetryTimer = null;
    }
  } catch (error) {
    setBridgeStatus(`Waiting for bridge: ${error.message}`, 'warn');
    if (!bridgeHealthRetryTimer) {
      bridgeHealthRetryTimer = setInterval(checkBridgeHealth, 3000);
    }
  }
}

function renderGhcpResponse(payload) {
  latestGhcpPayload = payload;
  const testCases = payload.test_cases || [];
  resultSection.hidden = false;
  outputActions.hidden = true;
  generatedFilesEl.innerHTML = '';
  resultBox.textContent = formatGhcpResponseForDisplay(payload);

  if (!testCases.length) {
    previewBox.textContent = 'No test cases returned by GHCP bridge.';
    return;
  }

  const previewLines = [];
  testCases.forEach((testCase, index) => {
    previewLines.push(`Feature: ${testCase.scenario_name || `Scenario ${index + 1}`}`);
    previewLines.push('');
    previewLines.push(`  Scenario: ${testCase.scenario_name || `Scenario ${index + 1}`}`);
    (testCase.preconditions || []).forEach((line) => previewLines.push(`    Given ${line}`));
    (testCase.steps || []).forEach((line) => previewLines.push(`    When ${line}`));
    (testCase.expected_results || []).forEach((line) => previewLines.push(`    Then ${line}`));
    previewLines.push('');
  });

  previewBox.textContent = previewLines.join('\n');
}

function formatGhcpResponseForDisplay(payload) {
  const textResponse = payload.response || payload.answer || payload.content || payload.message;
  if (typeof textResponse === 'string' && textResponse.trim()) {
    return textResponse.trim();
  }

  const testCases = payload.test_cases || [];
  if (!Array.isArray(testCases) || !testCases.length) {
    return 'No response content returned by GHCP bridge.';
  }

  const lines = ['Extracted GHCP response:', ''];
  testCases.forEach((testCase, idx) => {
    lines.push(`${idx + 1}. ${testCase.scenario_name || 'Scenario'}`);
    if (testCase.objective) {
      lines.push(`Objective: ${testCase.objective}`);
    }

    const keySteps = (testCase.steps || []).slice(0, 3);
    if (keySteps.length) {
      lines.push('Key steps:');
      keySteps.forEach((step) => lines.push(`- ${step}`));
    }

    const expected = (testCase.expected_results || []).slice(0, 2);
    if (expected.length) {
      lines.push('Expected:');
      expected.forEach((item) => lines.push(`- ${item}`));
    }

    lines.push('');
  });

  return lines.join('\n').trim();
}

async function packageAndSendCurrentSource() {
  const payload = getSourceFormPayload();
  const route = appConfig.ghcpPackageRoute || '/api/ghcp/package-and-generate';
  const formData = new FormData();

  formData.append('source', payload.source);
  formData.append('source_type', payload.source_type);
  formData.append('output_format', payload.output_format);
  formData.append('prompt', payload.prompt);
  formData.append('source_context', payload.source_context || '');
  if (payload.parsed_override) {
    formData.append('parsed_override', payload.parsed_override);
  }

  payload.selected_skills.forEach((name) => formData.append('selected_skills', name));
  payload.selected_instructions.forEach((name) => formData.append('selected_instructions', name));

  if (payload.source === 'document') {
    formData.append('file', payload.file);
    if (payload.page_start) {
      formData.append('page_start', payload.page_start);
    }
    if (payload.page_end) {
      formData.append('page_end', payload.page_end);
    }
    if (payload.row_start) {
      formData.append('row_start', payload.row_start);
    }
    if (payload.row_end) {
      formData.append('row_end', payload.row_end);
    }
    payload.sheet_names.forEach((sheetName) => formData.append('sheet_names', sheetName));
  } else {
    formData.append('source_url', payload.source_url);
    formData.append('username', payload.username || '');
    formData.append('password', payload.password || '');
    if (payload.story_ids) {
      formData.append('story_ids', payload.story_ids);
    }
    if (payload.url) {
      formData.append('url', payload.url);
    }
  }

  const response = await fetch(route, {
    method: 'POST',
    body: formData,
  });

  const responsePayload = await response.json();
  if (!response.ok) {
    throw new Error(responsePayload.error || 'Failed to package and send source to GHCP.');
  }

  latestGhcpArtifact = responsePayload.artifact;
  renderGhcpResponse(responsePayload.response);
}

async function previewCurrentSourceContext() {
  const payload = getSourceFormPayload();
  const previewFingerprint = getDocumentPreviewFingerprint(payload);
  const route = appConfig.ghcpSourcePreviewRoute || '/api/ghcp/source-preview';
  const formData = new FormData();

  formData.append('source', payload.source);
  formData.append('source_type', payload.source_type);
  formData.append('output_format', payload.output_format);
  formData.append('prompt', payload.prompt);
  formData.append('source_context', payload.source_context || '');

  payload.selected_skills.forEach((name) => formData.append('selected_skills', name));
  payload.selected_instructions.forEach((name) => formData.append('selected_instructions', name));

  if (payload.source === 'document') {
    formData.append('file', payload.file);
    if (payload.page_start) {
      formData.append('page_start', payload.page_start);
    }
    if (payload.page_end) {
      formData.append('page_end', payload.page_end);
    }
    if (payload.row_start) {
      formData.append('row_start', payload.row_start);
    }
    if (payload.row_end) {
      formData.append('row_end', payload.row_end);
    }
    payload.sheet_names.forEach((sheetName) => formData.append('sheet_names', sheetName));
  } else {
    formData.append('source_url', payload.source_url);
    formData.append('username', payload.username || '');
    formData.append('password', payload.password || '');
    if (payload.story_ids) {
      formData.append('story_ids', payload.story_ids);
    }
    if (payload.url) {
      formData.append('url', payload.url);
    }
  }

  const response = await fetch(route, {
    method: 'POST',
    body: formData,
  });

  const responsePayload = await response.json();
  if (!response.ok) {
    throw new Error(responsePayload.error || 'Unable to preview source context.');
  }

  previewState.isApplyingPreview = true;
  sourcePreviewBoxEl.value = responsePayload.combined_context || '';
  previewState.isApplyingPreview = false;
  previewState.fingerprint = previewFingerprint;
  autoResizeSourcePreview();
}

async function loadDocumentSheetsIfRequired() {
  const source = sourceEl.value;
  const file = fileInput.files[0];
  documentScopeEl.hidden = source !== 'document';

  if (source !== 'document' || !file) {
    excelTabsWrapEl.hidden = true;
    excelSheetsSelectEl.innerHTML = '';
    return;
  }

  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.xlsx')) {
    excelTabsWrapEl.hidden = true;
    excelSheetsSelectEl.innerHTML = '';
    return;
  }

  const route = appConfig.documentSheetsRoute || '/api/document/sheets';
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(route, {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to read Excel tabs.');
  }

  excelSheetsSelectEl.innerHTML = '';
  (payload.sheets || []).forEach((sheetName) => {
    const option = document.createElement('option');
    option.value = sheetName;
    option.textContent = sheetName;
    excelSheetsSelectEl.appendChild(option);
  });

  excelTabsWrapEl.hidden = false;
}

async function saveLatestGhcpAsFeature() {
  if (!latestGhcpPayload) {
    throw new Error('No GHCP response available to save.');
  }

  const route = appConfig.ghcpSaveFeatureRoute || '/api/ghcp/save-feature';
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response: latestGhcpPayload,
      artifact: latestGhcpArtifact || { source_type: 'ghcp', title: 'ghcp_generated_feature', metadata: {} },
      title: ghcpPromptEl.value.trim() || 'ghcp_generated_feature',
      raw_text: ghcpSourceContextEl.value.trim() || ghcpPromptEl.value.trim(),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to save GHCP response as feature file.');
  }

  renderGeneratedFiles([payload.path]);
  previewBox.textContent = `Saved feature file: ${payload.file}`;
  resultBox.textContent = `${resultBox.textContent}\n\nSaved feature file: ${payload.file}`;

  try {
    await previewSelectedFile();
  } catch {
    // Keep graceful behavior even if preview endpoint rejects temporarily.
  }

  return payload;
}

function openWizard(type) {
  const definition = wizardDefinitions[type];
  wizardState = {
    type,
    index: 0,
    values: {},
    definition,
  };
  wizardOverlay.hidden = false;
  renderWizardStep();
}

function toggleMenu(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : menuPanel.hidden;
  menuPanel.hidden = !shouldOpen;
  menuToggleBtn.setAttribute('aria-expanded', String(shouldOpen));
}

function closeWizard() {
  wizardOverlay.hidden = true;
  wizardState = null;
  wizardInput.value = '';
  wizardSample.textContent = 'Sample input will appear here.';
  wizardSummary.textContent = 'No details captured yet.';
  wizardPreview.textContent = 'Preview will appear here as markdown.';
}

function renderWizardStep() {
  if (!wizardState) {
    return;
  }

  const currentStep = wizardState.definition.steps[wizardState.index];
  wizardTitle.textContent = wizardState.definition.title;
  wizardStepMeta.textContent = `Step ${wizardState.index + 1} of ${wizardState.definition.steps.length} | ${currentStep.required ? 'Required' : 'Optional'}`;
  wizardPrompt.textContent = currentStep.prompt;
  wizardLabel.textContent = `${currentStep.label}${currentStep.required ? ' *' : ''}`;
  wizardHint.textContent = `${currentStep.hint || 'Provide the requested value.'} Use Ctrl+Enter to continue.`;
  wizardSample.textContent = `Sample: ${currentStep.sample || wizardSamplesByKey[currentStep.key] || 'Provide concise, business-relevant content.'}`;
  wizardInput.rows = currentStep.multiline ? 6 : 2;
  wizardInput.classList.toggle('single-line-mode', !currentStep.multiline);
  wizardInput.placeholder = currentStep.sample || wizardSamplesByKey[currentStep.key] || '';
  wizardInput.value = wizardState.values[currentStep.key] || '';
  renderWizardSummary();
  wizardNextBtn.hidden = wizardState.index >= wizardState.definition.steps.length - 1;
  wizardSubmitBtn.hidden = wizardState.index < wizardState.definition.steps.length - 1;
  wizardInput.focus();
}

function persistWizardValue() {
  if (!wizardState) {
    return false;
  }
  const currentStep = wizardState.definition.steps[wizardState.index];
  const value = normalizeValue(wizardInput.value);
  if (currentStep.required && !value) {
    wizardSummary.textContent = `Please enter ${currentStep.label.toLowerCase()} before continuing.`;
    return false;
  }

  if (!value) {
    delete wizardState.values[currentStep.key];
  } else {
    wizardState.values[currentStep.key] = value;
  }
  renderWizardSummary();
  return true;
}

async function submitWizard() {
  if (!wizardState || !persistWizardValue()) {
    return;
  }

  const missingRequired = getRequiredMissing(wizardState.definition, wizardState.values);
  if (missingRequired.length) {
    wizardSummary.textContent = `Missing required fields: ${missingRequired.join(', ')}`;
    return;
  }

  const route = wizardState.definition.submitRoute();
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wizardState.values),
  });
  const payload = await response.json();
  if (!response.ok) {
    wizardSummary.textContent = `Error: ${payload.error || 'Unable to create file.'}`;
    return;
  }

  wizardSummary.textContent = `Created file: ${payload.file}`;
  await loadReferenceFiles();
  closeWizard();
}

function updateActionMode() {
  const isTestCaseMode = actionTypeEl.value === 'test_cases';
  const isAutomationMode = actionTypeEl.value === 'automation_scripts';
  testCaseFieldsEl.hidden = !isTestCaseMode;
  ghcpPanelEl.hidden = !actionTypeEl.value;
  actionNoticeEl.hidden = !isAutomationMode;

  if (!isTestCaseMode) {
    resetResults();
  }
}

function updateMode() {
  const source = sourceEl.value;
  const isDocument = source === 'document';
  uploadGroup.hidden = !isDocument;
  urlGroup.hidden = isDocument;
  authGroup.hidden = isDocument;
  documentScopeEl.hidden = !isDocument;

  if (isDocument) {
    sourceUrlEl.value = '';
    apiUsernameEl.value = '';
    apiPasswordEl.value = '';
  } else {
    fileInput.value = '';
  }

  sourcePreviewBoxEl.value = '';
  autoResizeSourcePreview();
}

function autoDetectSource(text) {
  const value = (text || '').toLowerCase();
  if (value.includes('confluence') || value.includes('/wiki/')) {
    sourceEl.value = 'confluence';
  } else if (value.includes('jira') || /^[a-z]+-\d+(\s*,\s*[a-z]+-\d+)*$/i.test(text)) {
    sourceEl.value = 'jira';
  }
  updateMode();
}

actionTypeEl.addEventListener('change', updateActionMode);
sourceEl.addEventListener('change', updateMode);
sourceUrlEl.addEventListener('input', (e) => autoDetectSource(e.target.value));
fileInput.addEventListener('change', async () => {
  try {
    resetDocumentScopeInputs();
    await loadDocumentSheetsIfRequired();
    await autoPreviewDocumentContent();
  } catch (error) {
    sourcePreviewBoxEl.value = `Error: ${error.message}`;
    autoResizeSourcePreview();
    setBridgeStatus(`Unable to prepare source preview: ${error.message}`, 'warn');
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', (event) => {
  const files = event.dataTransfer.files;
  if (files && files.length > 0) {
    fileInput.files = files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

function toFileName(pathValue) {
  const normalized = String(pathValue || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function renderGeneratedFiles(outputs) {
  generatedFiles = (outputs || []).map((item) => ({
    fullPath: item,
    fileName: toFileName(item),
  }));

  generatedFilesEl.innerHTML = '';
  if (!generatedFiles.length) {
    outputActions.hidden = true;
    previewBox.textContent = 'No generated files available for preview.';
    return;
  }

  generatedFiles.forEach((file, index) => {
    const option = document.createElement('option');
    option.value = file.fileName;
    option.textContent = file.fileName;
    if (index === 0) {
      option.selected = true;
    }
    generatedFilesEl.appendChild(option);
  });

  outputActions.hidden = false;
  previewBox.textContent = 'Select a generated file and click Preview File.';
}

async function previewSelectedFile() {
  const selected = generatedFilesEl.value;
  if (!selected) {
    throw new Error('Please select a generated file to preview.');
  }

  const previewRoute = appConfig.outputContentRoute || '/api/output/content';
  const response = await fetch(`${previewRoute}?file=${encodeURIComponent(selected)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to preview file.');
  }
  previewBox.textContent = payload.content;
}

function downloadSelectedFile() {
  const selected = generatedFilesEl.value;
  if (!selected) {
    throw new Error('Please select a generated file to download.');
  }
  const downloadRoute = appConfig.outputDownloadRoute || '/api/output/download';
  const downloadUrl = `${downloadRoute}?file=${encodeURIComponent(selected)}`;
  window.open(downloadUrl, '_blank');
}

generateBtn.addEventListener('click', async () => {
  if (actionTypeEl.value !== 'test_cases') {
    return;
  }

  resultSection.hidden = false;
  resultBox.textContent = 'Running GHCP generation...';
  previewBox.textContent = 'Waiting for generation to complete...';
  outputActions.hidden = true;
  setBridgeStatus('Packaging source and sending to GHCP...', 'warn');
  try {
    if (sourceEl.value === 'document') {
      const currentPayload = getSourceFormPayload();
      const currentFingerprint = getDocumentPreviewFingerprint(currentPayload);
      const requiresRefresh = !sourcePreviewBoxEl.value.trim() || previewState.fingerprint !== currentFingerprint;
      if (requiresRefresh) {
        await autoPreviewDocumentContent();
      }
    }
    await packageAndSendCurrentSource();
    await saveLatestGhcpAsFeature();
    setBridgeStatus('GHCP response received and feature saved', 'ok');
  } catch (error) {
    setBridgeStatus(`Generation failed: ${error.message}`, 'error');
    resultBox.textContent = `Error: ${error.message}`;
    previewBox.textContent = 'No preview available.';
  }
});

previewBtn.addEventListener('click', async () => {
  previewBox.textContent = 'Loading preview...';
  try {
    await previewSelectedFile();
  } catch (error) {
    previewBox.textContent = `Error: ${error.message}`;
  }
});

downloadBtn.addEventListener('click', () => {
  try {
    downloadSelectedFile();
  } catch (error) {
    previewBox.textContent = `Error: ${error.message}`;
  }
});

addSkillBtn.addEventListener('click', () => openWizard('skill'));
addInstructionBtn.addEventListener('click', () => openWizard('instruction'));
menuToggleBtn.addEventListener('click', () => toggleMenu());
devDocsBtn.addEventListener('click', () => {
  const route = appConfig.devDocsRoute || '/dev-docs';
  window.open(route, '_blank', 'noopener');
});
savePromptBtn.addEventListener('click', async () => {
  try {
    await savePromptWithKeyword();
    setBridgeStatus('Prompt saved successfully', 'ok');
  } catch (error) {
    setBridgeStatus(`Save prompt failed: ${error.message}`, 'error');
  }
});
previewSourceBtn.addEventListener('click', async () => {
  sourcePreviewBoxEl.value = 'Building exact source payload preview...';
  autoResizeSourcePreview();
  try {
    await previewCurrentSourceContext();
    setBridgeStatus('Source preview prepared', 'ok');
  } catch (error) {
    sourcePreviewBoxEl.value = `Error: ${error.message}`;
    autoResizeSourcePreview();
    setBridgeStatus(`Source preview failed: ${error.message}`, 'error');
  }
});
savedPromptSelectEl.addEventListener('change', async (event) => {
  const keyword = event.target.value;
  if (!keyword) {
    return;
  }
  try {
    await loadPromptByKeyword(keyword);
    setBridgeStatus(`Loaded prompt: ${keyword}`, 'ok');
  } catch (error) {
    setBridgeStatus(`Load prompt failed: ${error.message}`, 'error');
  }
});
ghcpPromptEl.addEventListener('input', () => {
  updateSavePromptVisibility();
});
closeWizardBtn.addEventListener('click', closeWizard);
wizardNextBtn.addEventListener('click', () => {
  if (!persistWizardValue()) {
    return;
  }
  wizardState.index += 1;
  renderWizardStep();
});
wizardSubmitBtn.addEventListener('click', async () => {
  await submitWizard();
});

testCaseFieldsEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  generateBtn.click();
});

wizardInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) {
    return;
  }

  event.preventDefault();
  if (wizardSubmitBtn.hidden) {
    wizardNextBtn.click();
  } else {
    await submitWizard();
  }
});

wizardInput.addEventListener('input', () => {
  renderWizardSummary();
});

sourcePreviewBoxEl.addEventListener('input', () => {
  if (!previewState.isApplyingPreview) {
    previewState.fingerprint = '';
  }
  autoResizeSourcePreview();
});

[pageStartEl, pageEndEl, rowStartEl, rowEndEl, ghcpSourceContextEl].forEach((element) => {
  element.addEventListener('input', () => {
    previewState.fingerprint = '';
  });
});

excelSheetsSelectEl.addEventListener('change', () => {
  previewState.fingerprint = '';
});

skillsSelectionListEl.addEventListener('change', () => {
  previewState.fingerprint = '';
});

instructionsSelectionListEl.addEventListener('change', () => {
  previewState.fingerprint = '';
});

document.addEventListener('click', (event) => {
  if (menuPanel.hidden) {
    return;
  }

  if (!menuPanel.contains(event.target) && event.target !== menuToggleBtn) {
    toggleMenu(false);
  }
});

updateActionMode();
updateMode();
loadReferenceFiles();
loadSavedPrompts();
updateSavePromptVisibility();
autoResizeSourcePreview();
checkBridgeHealth();
