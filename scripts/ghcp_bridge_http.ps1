param(
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,
  [Parameter(Mandatory = $true)]
  [string]$ResponseFile,
  [Parameter(Mandatory = $false)]
  [string]$BridgeBaseUrl = "http://127.0.0.1:8765",
  [Parameter(Mandatory = $false)]
  [string]$BridgeAuthToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PromptFile)) {
  throw "Prompt file not found: $PromptFile"
}

$raw = Get-Content -LiteralPath $PromptFile -Raw
$headers = @{ "Content-Type" = "application/json" }
if ($BridgeAuthToken) {
  $headers["Authorization"] = "Bearer $BridgeAuthToken"
}

$uri = "$($BridgeBaseUrl.TrimEnd('/'))/v1/generate"
$response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $raw -TimeoutSec 180

if (-not $response.test_cases) {
  throw "Bridge response does not include test_cases"
}

$response | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ResponseFile -Encoding UTF8
