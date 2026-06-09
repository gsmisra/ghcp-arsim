const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

let serverRef = null;
let activeRequests = 0;

function getSettings() {
  const cfg = vscode.workspace.getConfiguration('ghcpBridge');
  return {
    enabled: cfg.get('enabled', true),
    host: cfg.get('host', '127.0.0.1'),
    port: cfg.get('port', 8765),
    authToken: cfg.get('authToken', ''),
    adapterCommand: cfg.get('adapterCommand', ''),
    adapterTimeoutMs: cfg.get('adapterTimeoutMs', 180000),
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

function mkTempFile(prefix) {
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.json`;
  return path.join(os.tmpdir(), name);
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
      return parsedJson;
    }
    if (parsedJson.response && Array.isArray(parsedJson.response.test_cases)) {
      return parsedJson.response;
    }
  }

  const parsedFeature = parseFeatureLikeText(text, artifact);
  if (parsedFeature) {
    return parsedFeature;
  }

  const fallbackText = String(text || '').trim();
  return {
    test_cases: [
      {
        scenario_name: artifact.title || 'GHCP Scenario',
        objective: fallbackText || 'GHCP generated objective',
        preconditions: [],
        steps: fallbackText ? fallbackText.split(/\r?\n/).filter(Boolean).slice(0, 8) : ['Review GHCP output'],
        expected_results: fallbackText ? [fallbackText] : ['A response is generated by GHCP'],
        tags: ['ghcp'],
        examples: [],
      },
    ],
    raw_response: fallbackText,
  };
}

async function generateWithLanguageModel(payload) {
  let models = await vscode.lm.selectChatModels();
  if (!models || models.length === 0) {
    throw new Error('No VS Code language models are available. Make sure GHCP/Copilot chat access is enabled.');
  }

  const [model] = models;
  const prompt = [
    'You are an enterprise QE assistant inside VS Code.',
    'Generate only strictly grounded test cases from the provided requirement context.',
    'Return valid JSON only with this shape:',
    '{ "test_cases": [ { "scenario_name": "...", "objective": "...", "preconditions": ["..."], "steps": ["..."], "expected_results": ["..."], "tags": ["..."], "examples": [ {"key":"value"} ] } ] }',
    'Do not add markdown fences or commentary.',
    '',
    `Instruction:\n${payload.instruction || ''}`,
    `Maximum cases: ${payload.max_cases || 3}`,
    `Source type: ${payload.artifact?.source_type || 'unknown'}`,
    `Title: ${payload.artifact?.title || 'untitled'}`,
    `Requirement context:\n${payload.artifact?.raw_text || ''}`,
  ].join(' ');

  const messages = [
    vscode.LanguageModelChatMessage.User(prompt),
  ];

  const response = await model.sendRequest(messages, {}, undefined);
  let text = '';
  for await (const fragment of response.text) {
    text += fragment;
  }

  return coerceBridgeResponse(text, payload.artifact || {});
}

function runAdapterCommand(commandTemplate, requestFile, responseFile, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!commandTemplate || !commandTemplate.trim()) {
      reject(new Error('ghcpBridge.adapterCommand is empty. Configure it in VS Code settings.'));
      return;
    }

    const command = commandTemplate
      .replaceAll('{request_file}', requestFile)
      .replaceAll('{response_file}', responseFile);

    const child = exec(command, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Adapter command failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });

    child.on('error', reject);
  });
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
  const requestFile = mkTempFile('ghcp-bridge-request');
  const responseFile = mkTempFile('ghcp-bridge-response');

  try {
    fs.writeFileSync(requestFile, JSON.stringify(payload, null, 2), 'utf8');
    let output;

    if (settings.adapterCommand && settings.adapterCommand.trim()) {
      await runAdapterCommand(settings.adapterCommand, requestFile, responseFile, settings.adapterTimeoutMs);

      if (!fs.existsSync(responseFile)) {
        throw new Error('Adapter did not create response file.');
      }

      const outputText = fs.readFileSync(responseFile, 'utf8');
      output = JSON.parse(outputText);
    } else {
      output = await generateWithLanguageModel(payload);
    }

    if (!output || !Array.isArray(output.test_cases)) {
      throw new Error("Adapter response must include 'test_cases' array.");
    }

    writeJson(res, 200, output);
  } catch (error) {
    writeJson(res, 500, {
      error: String(error && error.message ? error.message : error),
    });
  } finally {
    activeRequests -= 1;
    try {
      if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
    } catch {}
    try {
      if (fs.existsSync(responseFile)) fs.unlinkSync(responseFile);
    } catch {}
  }
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
      writeJson(res, 200, {
        status: 'ok',
        activeRequests,
      });
      return;
    }

    if (method === 'POST' && url === '/v1/generate') {
      await handleGenerate(req, res, settings);
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
