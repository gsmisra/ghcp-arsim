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

function renderReferenceLog(payload) {
  const skills = payload.skills || [];
  const instructions = payload.instructions || [];
  referenceLogEl.textContent = [
    'Skills referenced on load:',
    ...(skills.length ? skills.map((item) => `- ${item}`) : ['- none']),
    '',
    'Instructions referenced on load:',
    ...(instructions.length ? instructions.map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
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
    referenceLogEl.textContent = `Error loading referenced files: ${error.message}`;
  }
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

  if (isDocument) {
    sourceUrlEl.value = '';
    apiUsernameEl.value = '';
    apiPasswordEl.value = '';
  } else {
    fileInput.value = '';
  }
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
  }
});

async function generateFromDocument() {
  const file = fileInput.files[0];
  if (!file) {
    throw new Error('Please upload a requirement document file.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('output_format', outputFormatEl.value);

  const documentRoute = appConfig.generateDocumentRoute || '/api/generate/document';

  const response = await fetch(documentRoute, {
    method: 'POST',
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Document processing failed');
  }
  return payload.outputs;
}

async function generateFromConfluenceOrJira() {
  const value = sourceUrlEl.value.trim();
  if (!value) {
    throw new Error('Please provide Confluence URL/page ID or Jira story IDs.');
  }

  const username = apiUsernameEl.value.trim();
  const password = apiPasswordEl.value;
  if (!username || !password) {
    throw new Error('Please enter username and password for Jira/Confluence access.');
  }

  const source = sourceEl.value;
  const output_format = outputFormatEl.value;
  const endpoint = source === 'confluence'
    ? (appConfig.generateConfluenceRoute || '/api/generate/confluence')
    : (appConfig.generateJiraRoute || '/api/generate/jira');
  const payload = source === 'confluence'
    ? { url: value, output_format, username, password }
    : { story_ids: value, output_format, username, password };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responsePayload = await response.json();
    if (!response.ok) {
      throw new Error(responsePayload.error || 'Source processing failed');
    }
    return responsePayload.outputs;
  } finally {
    apiPasswordEl.value = '';
  }
}

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
  resultBox.textContent = 'Running generation...';
  previewBox.textContent = 'Waiting for generation to complete...';
  outputActions.hidden = true;
  try {
    const outputs = sourceEl.value === 'document'
      ? await generateFromDocument()
      : await generateFromConfluenceOrJira();

    resultBox.textContent = `Success. Generated outputs:\n${outputs.map((x) => `- ${x}`).join('\n')}`;
    renderGeneratedFiles(outputs);
  } catch (error) {
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
