param(
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,
  [Parameter(Mandatory = $true)]
  [string]$ResponseFile,
  [Parameter(Mandatory = $false)]
  [string]$VscodeWindowTitle = 'Visual Studio Code',
  [Parameter(Mandatory = $false)]
  [string]$ChatInputAutomationId = '',
  [Parameter(Mandatory = $false)]
  [string]$ChatInputName = '',
  [Parameter(Mandatory = $false)]
  [string]$ResponseTextAutomationId = '',
  [Parameter(Mandatory = $false)]
  [int]$TimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not (Test-Path -LiteralPath $PromptFile)) {
  throw "Prompt file not found: $PromptFile"
}

function Get-RootAutomationElement {
  param(
    [string]$WindowTitle
  )

  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $WindowTitle
  )
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $condition
  )

  if ($windows.Count -gt 0) {
    return $windows.Item(0)
  }

  $fallbackCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
  )
  $allWindows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $fallbackCondition
  )

  foreach ($window in $allWindows) {
    if ($window.Current.Name -like "*$WindowTitle*") {
      return $window
    }
  }

  throw "Could not find a VS Code window matching '$WindowTitle'."
}

function Find-DescendantControl {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$AutomationId,
    [string]$Name,
    [System.Windows.Automation.ControlType]$ControlType
  )

  $conditions = @()
  if ($AutomationId) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      $AutomationId
    )
  }
  if ($Name) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $Name
    )
  }
  if ($ControlType) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      $ControlType
    )
  }

  if ($conditions.Count -eq 0) {
    return $null
  }

  $match = $conditions[0]
  for ($i = 1; $i -lt $conditions.Count; $i++) {
    $match = New-Object System.Windows.Automation.AndCondition($match, $conditions[$i])
  }

  return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $match)
}

function Invoke-ControlPattern {
  param(
    [System.Windows.Automation.AutomationElement]$Element
  )

  if ($null -eq $Element) {
    return $false
  }

  $pattern = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
    return $true
  }

  return $false
}

function Wait-ForResponseText {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [string]$AutomationId,
    [int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $previousText = ''

  while ([DateTime]::UtcNow -lt $deadline) {
    $responseElement = $null
    if ($AutomationId) {
      $responseElement = Find-DescendantControl -Root $Root -AutomationId $AutomationId -ControlType ([System.Windows.Automation.ControlType]::Text)
    }

    if ($responseElement) {
      $valuePattern = $null
      if ($responseElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
        $text = [string]$valuePattern.Current.Value
        if ($text -and $text -ne $previousText) {
          return $text
        }
      }

      $textPattern = $null
      if ($responseElement.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
        $text = $textPattern.DocumentRange.GetText(-1)
        if ($text -and $text -ne $previousText) {
          return $text
        }
      }
    }

    Start-Sleep -Milliseconds 750
  }

  throw 'Timed out waiting for GHCP response text in the VS Code window.'
}

$promptPayload = Get-Content -LiteralPath $PromptFile -Raw | ConvertFrom-Json
$promptText = [string]($promptPayload.instruction)
if (-not $promptText.Trim()) {
  throw 'The request file does not contain an instruction prompt.'
}

$root = Get-RootAutomationElement -WindowTitle $VscodeWindowTitle
try {
  $windowPattern = $null
  if ($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$windowPattern)) {
    $windowPattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
  }
} catch {
  # Ignore if the window pattern is unavailable.
}

$root.SetFocus()
[System.Windows.Forms.SendKeys]::SendWait('% ') 
Start-Sleep -Milliseconds 300

$chatInput = $null
if ($ChatInputAutomationId) {
  $chatInput = Find-DescendantControl -Root $root -AutomationId $ChatInputAutomationId -ControlType ([System.Windows.Automation.ControlType]::Edit)
}

if (-not $chatInput -and $ChatInputName) {
  $chatInput = Find-DescendantControl -Root $root -Name $ChatInputName -ControlType ([System.Windows.Automation.ControlType]::Edit)
}

if (-not $chatInput) {
  throw 'Could not find a chat input control. Set ChatInputAutomationId or ChatInputName for your GHCP chat box.'
}

try {
  $inputPattern = $null
  if (-not $chatInput.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$inputPattern)) {
    throw 'The chat input control does not support ValuePattern.'
  }

  [System.Windows.Forms.Clipboard]::SetText($promptText)
  $chatInput.SetFocus()
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
} catch {
  throw "Failed to submit prompt to GHCP chat window: $($_.Exception.Message)"
}

$finalText = Wait-ForResponseText -Root $root -AutomationId $ResponseTextAutomationId -TimeoutSeconds $TimeoutSeconds

$response = [ordered]@{
  test_cases = @(
    [ordered]@{
      scenario_name = 'GHCP chat window response captured'
      objective = 'Prompt was sent through the VS Code chat window and response text was captured'
      preconditions = @(
        'VS Code is open with the GHCP chat window visible',
        'The GHCP response area is accessible for reading'
      )
      steps = @(
        'Send the prompt from the request file into the GHCP chat window',
        'Wait for the GHCP response text to appear',
        'Capture the response text and forward it to the bridge server'
      )
      expected_results = @(
        'A GHCP response is obtained from the chat window',
        'The bridge response JSON is written for the Flask UI'
      )
      tags = @('ghcp', 'chat-window', 'windows-automation')
      examples = @(
        [ordered]@{
          captured_response_preview = ($finalText.Substring(0, [Math]::Min(200, $finalText.Length)))
        }
      )
    }
  )
}

$response | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ResponseFile -Encoding UTF8
