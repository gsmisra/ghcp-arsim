# GHCP Local Bridge Extension

This extension starts a localhost HTTP server inside VS Code extension host.

## Endpoints
- GET /health
- POST /v1/generate

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
- ghcpBridge.adapterCommand
- ghcpBridge.adapterTimeoutMs

## Adapter command
If configured, the extension executes ghcpBridge.adapterCommand and replaces:
- {request_file}
- {response_file}

The adapter command must read request JSON and write response JSON with test_cases.

## Default behavior
If ghcpBridge.adapterCommand is empty, the extension uses the VS Code language model API directly and returns the model response as test_cases JSON.

## Optional fallback template
The repository includes a PowerShell Windows chat-window template for teams that want manual UI automation against a VS Code GHCP chat panel. Use it only if you need window-driven automation.

## Start and stop
Commands:
- GHCP Bridge: Start Server
- GHCP Bridge: Stop Server
