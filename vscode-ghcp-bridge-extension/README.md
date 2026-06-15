# GHCP Local Bridge Extension

This extension starts a localhost HTTP server inside VS Code extension host.
It only uses the VS Code Language Model API (GitHub Copilot chat models).

## Endpoints
- GET /health
- POST /v1/generate

## Health response
GET /health returns:
- status
- modelsAvailable
- modelCount
- mode (vscode-language-model-api)
- activeRequests

## Request contract for POST /v1/generate
Input JSON should include:
- instruction
- max_cases
- artifact (source_type, title, raw_text, metadata)

## Response contract
Output JSON must include:
- test_cases (array)

## Settings
- ghcpBridge.enabled
- ghcpBridge.host
- ghcpBridge.port
- ghcpBridge.authToken
- ghcpBridge.maxConcurrentRequests

## Behavior
The extension uses vscode.lm.selectChatModels() and model.sendRequest() directly.
Responses are validated and must contain a non-empty test_cases array.
Malformed JSON/BDD responses are rejected.

## Start and stop
Commands:
- GHCP Bridge: Start Server
- GHCP Bridge: Stop Server
