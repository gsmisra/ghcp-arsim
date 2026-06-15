const vscode = require('vscode');
const http = require('http');

let serverRef = null;
let activeRequests = 0;

function getSettings() {
  const cfg = vscode.workspace.getConfiguration('ghcpBridge');
  return {
    enabled: cfg.get('enabled', true),
    host: cfg.get('host', '127.0.0.1'),
    port: cfg.get('port', 8765),
    authToken: cfg.get('authToken', ''),
    maxConcurrentRequests: Math.max(1, cfg.get('maxConcurrentRequests', 2)),
  };
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function ensureAuthorized(req, token) {
  if (!token) {
    return true;
  }
  const header = String(req.headers.authorization || '');
  return header === `Bearer ${token}`;
}

function stripCodeFence(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function tryParseJson(text) {
  const candidate = stripCodeFence(text);
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
  }
  return null;
}

function normalizeExampleLines(lines) {
  const example = {};
  lines.forEach((line, index) => {
    example[`value_${index + 1}`] = line;
  });
  return example;
}

function parseFeatureLikeText(text, artifact) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const testCases = [];
  let current = null;
  let currentSection = '';

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    testCases.push({
      scenario_name: current.scenario_name || artifact.title || 'GHCP Scenario',
      objective: current.objective || current.scenario_name || artifact.title || 'GHCP generated objective',
      preconditions: current.preconditions,
      steps: current.steps,
      expected_results: current.expected_results,
      tags: current.tags,
      examples: current.examples,
    });
  };

  const startScenario = (name) => {
    pushCurrent();
    current = {
      scenario_name: name || artifact.title || 'GHCP Scenario',
      objective: '',
      preconditions: [],
      steps: [],
      expected_results: [],
      tags: [],
      examples: [],
    };
    currentSection = '';
  };

  lines.forEach((line) => {
    const featureMatch = line.match(/^Feature:\s*(.+)$/i);
    if (featureMatch) {
      return;
    }

    const numberedMatch = line.match(/^\d+\.\s*(.+)$/);
    const scenarioMatch = line.match(/^(?:Scenario Outline|Scenario|Test Case|Case):\s*(.+)$/i);
    if (scenarioMatch) {
      startScenario(scenarioMatch[1].trim());
      return;
    }
    if (numberedMatch) {
      startScenario(numberedMatch[1].trim());
      return;
    }

    if (!current) {
      current = {
        scenario_name: artifact.title || 'GHCP Scenario',
        objective: '',
        preconditions: [],
        steps: [],
        expected_results: [],
        tags: [],
        examples: [],
      };
    }

    if (/^objective:/i.test(line)) {
      current.objective = line.replace(/^objective:\s*/i, '').trim();
      currentSection = 'objective';
      return;
    }
    if (/^(preconditions|key steps|steps|expected results|expected|tags|examples):/i.test(line)) {
      currentSection = line.split(':')[0].toLowerCase();
      return;
    }
    if (/^(given|when|then|and)\b/i.test(line)) {
      current.steps.push(line);
      return;
    }

    if (currentSection === 'preconditions' && line.startsWith('-')) {
      current.preconditions.push(line.replace(/^-+\s*/, ''));
      return;
    }
    if (currentSection === 'key steps' || currentSection === 'steps') {
      current.steps.push(line.replace(/^[-*]\s*/, ''));
      return;
    }
    if (currentSection === 'expected results' || currentSection === 'expected') {
      current.expected_results.push(line.replace(/^[-*]\s*/, ''));
      return;
    }
    if (currentSection === 'tags' && line.startsWith('-')) {
      current.tags.push(line.replace(/^-+\s*/, ''));
      return;
    }
    if (currentSection === 'examples') {
      current.examples.push(normalizeExampleLines([line]));
      return;
    }
  });

  pushCurrent();

  return testCases.length ? { test_cases: testCases } : null;
}

function coerceBridgeResponse(text, artifact) {
  const parsedJson = tryParseJson(text);
  if (parsedJson) {
    if (Array.isArray(parsedJson.test_cases)) {
      validateBridgeResponse(parsedJson);
      return parsedJson;
    }
    if (parsedJson.response && Array.isArray(parsedJson.response.test_cases)) {
      validateBridgeResponse(parsedJson.response);
      return parsedJson.response;
    }
  }

  const parsedFeature = parseFeatureLikeText(text, artifact);
  if (parsedFeature) {
    validateFeatureLikeOutput(text);
    validateBridgeResponse(parsedFeature);
    return parsedFeature;
  }

  throw new Error("Model response could not be parsed as valid JSON 'test_cases' or BDD output.");
}

function validateFeatureLikeOutput(text) {
  const raw = String(text || '');
  if (!/Feature:\s*.+/i.test(raw)) {
    throw new Error("BDD output missing required 'Feature:' line.");
  }
  if (!/(Scenario|Scenario Outline):\s*.+/i.test(raw)) {
    throw new Error("BDD output missing required 'Scenario:' or 'Scenario Outline:' line.");
  }
}

function validateBridgeResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Bridge response must be a JSON object.');
  }

  if (!Array.isArray(payload.test_cases) || payload.test_cases.length === 0) {
    throw new Error("Bridge response must include a non-empty 'test_cases' array.");
  }

  const arrayFields = ['preconditions', 'steps', 'expected_results', 'tags', 'examples'];
  payload.test_cases.forEach((testCase, index) => {
    if (!testCase || typeof testCase !== 'object') {
      throw new Error(`test_cases[${index}] must be an object.`);
    }
    ['scenario_name', 'objective'].forEach((field) => {
      const value = testCase[field];
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`test_cases[${index}].${field} must be a non-empty string.`);
      }
    });
    arrayFields.forEach((field) => {
      if (!Array.isArray(testCase[field])) {
        throw new Error(`test_cases[${index}].${field} must be an array.`);
      }
    });
  });
}

async function generateWithLanguageModel(payload) {
  let models = await vscode.lm.selectChatModels();
  if (!models || models.length === 0) {
    throw new Error('No VS Code language models are available. Make sure GHCP/Copilot chat access is enabled.');
  }

  const [model] = models;
  const promptSections = [
    'SYSTEM ROLE:\nYou are an enterprise QE assistant inside VS Code.',
    (
      'OUTPUT CONTRACT:\n'
      + 'Return valid JSON only with this shape:\n'
      + '{ "test_cases": [ { "scenario_name": "...", "objective": "...", "preconditions": ["..."], "steps": ["..."], "expected_results": ["..."], "tags": ["..."], "examples": [ {"key":"value"} ] } ] }\n'
      + 'Do not add markdown fences or commentary.'
    ),
    `SELECTED SKILLS:\n${Array.isArray(payload.artifact?.metadata?.selected_skills) ? payload.artifact.metadata.selected_skills.join(', ') : 'None selected.'}`,
    `SELECTED INSTRUCTIONS:\n${Array.isArray(payload.artifact?.metadata?.selected_instructions) ? payload.artifact.metadata.selected_instructions.join(', ') : 'None selected.'}`,
    (
      'REQUIREMENT CONTEXT:\n'
      + `Instruction: ${payload.instruction || ''}\n`
      + `Maximum cases: ${payload.max_cases || 3}\n`
      + `Source type: ${payload.artifact?.source_type || 'unknown'}\n`
      + `Title: ${payload.artifact?.title || 'untitled'}\n\n`
      + `${payload.artifact?.raw_text || ''}`
    ),
  ];
  const prompt = promptSections.join('\n\n');

  const messages = [
    vscode.LanguageModelChatMessage.User(prompt),
  ];

  const response = await model.sendRequest(messages, {}, undefined);
  let text = '';
  for await (const fragment of response.text) {
    text += fragment;
  }

  const output = coerceBridgeResponse(text, payload.artifact || {});
  validateBridgeResponse(output);
  return output;
}

async function handleTestConnection(req, res, settings) {
  if (!ensureAuthorized(req, settings.authToken)) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    const models = await vscode.lm.selectChatModels();
    if (!models || models.length === 0) {
      throw new Error('No VS Code language models are available. Make sure GHCP/Copilot chat access is enabled.');
    }

    const [model] = models;
    const messages = [
      vscode.LanguageModelChatMessage.User('Who are you?'),
    ];

    const response = await model.sendRequest(messages, {}, undefined);
    let text = '';
    for await (const fragment of response.text) {
      text += fragment;
    }

    writeJson(res, 200, {
      status: 'ok',
      model: model.name || model.id || 'unknown',
      response: text.trim(),
    });
  } catch (error) {
    writeJson(res, 500, {
      status: 'error',
      error: String(error && error.message ? error.message : error),
    });
  }
}

async function handleGenerate(req, res, settings) {
  if (activeRequests >= settings.maxConcurrentRequests) {
    writeJson(res, 429, {
      error: 'Too many concurrent requests. Try again shortly.',
    });
    return;
  }

  if (!ensureAuthorized(req, settings.authToken)) {
    writeJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  let payload;
  try {
    const raw = await readRequestBody(req);
    payload = JSON.parse(raw);
  } catch {
    writeJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    writeJson(res, 400, { error: 'Request body is required' });
    return;
  }

  activeRequests += 1;

  try {
    const output = await generateWithLanguageModel(payload);

    writeJson(res, 200, output);
  } catch (error) {
    writeJson(res, 500, {
      error: String(error && error.message ? error.message : error),
    });
  } finally {
    activeRequests -= 1;
  }
}

async function getModelHealth() {
  const models = await vscode.lm.selectChatModels();
  const modelCount = Array.isArray(models) ? models.length : 0;
  return {
    status: 'ok',
    modelsAvailable: modelCount > 0,
    modelCount,
    mode: 'vscode-language-model-api',
    activeRequests,
  };
}

function createServer(context) {
  const settings = getSettings();

  if (serverRef) {
    return;
  }

  serverRef = http.createServer(async (req, res) => {
    const method = String(req.method || '').toUpperCase();
    const url = String(req.url || '');

    if (method === 'GET' && url === '/health') {
      try {
        writeJson(res, 200, await getModelHealth());
      } catch (error) {
        writeJson(res, 500, {
          status: 'error',
          modelsAvailable: false,
          modelCount: 0,
          mode: 'vscode-language-model-api',
          error: String(error && error.message ? error.message : error),
        });
      }
      return;
    }

    if (method === 'POST' && url === '/v1/generate') {
      await handleGenerate(req, res, settings);
      return;
    }

    if (method === 'POST' && url === '/v1/test-connection') {
      await handleTestConnection(req, res, settings);
      return;
    }

    writeJson(res, 404, { error: 'Not found' });
  });

  serverRef.listen(settings.port, settings.host, () => {
    const msg = `GHCP bridge server listening on http://${settings.host}:${settings.port}`;
    vscode.window.showInformationMessage(msg);
    context.subscriptions.push(
      vscode.Disposable.from({
        dispose: () => {
          if (serverRef) {
            serverRef.close();
            serverRef = null;
          }
        },
      })
    );
  });

  serverRef.on('error', (error) => {
    vscode.window.showErrorMessage(`GHCP bridge server error: ${error.message}`);
  });
}

function stopServer() {
  if (serverRef) {
    serverRef.close();
    serverRef = null;
    vscode.window.showInformationMessage('GHCP bridge server stopped.');
  }
}

function activate(context) {
  const startCmd = vscode.commands.registerCommand('ghcpBridge.start', () => createServer(context));
  const stopCmd = vscode.commands.registerCommand('ghcpBridge.stop', () => stopServer());

  context.subscriptions.push(startCmd, stopCmd);

  const settings = getSettings();
  if (settings.enabled) {
    createServer(context);
  }
}

function deactivate() {
  stopServer();
}

module.exports = {
  activate,
  deactivate,
};
