# Offline checks only: the aws function below intercepts every seed CLI call.
$ErrorActionPreference = 'Stop'
$seedPath = Join-Path $PSScriptRoot 'seed-demo-device.ps1'
$runbookPath = Join-Path $PSScriptRoot '../docs/21_DAY1_IOT_DEPLOYMENT.md'
foreach ($path in @($seedPath, $PSCommandPath)) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw "PowerShell syntax errors in $path" }
}
$runbook = Get-Content -LiteralPath $runbookPath -Raw
foreach ($block in [regex]::Matches($runbook, '(?s)```powershell\r?\n(.*?)```')) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseInput($block.Groups[1].Value, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw 'PowerShell syntax errors in provisioning/deployment runbook.' }
}

$item = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'demo-device-item.json') -Raw | ConvertFrom-Json
if ($item.deviceId.S -ne 'cold-room-01' -or $item.monitoringState.S -ne 'NORMAL' -or $item.version.N -ne '0') {
    throw 'Invalid demo identity, initial state or version.'
}
foreach ($field in @('breachStartedAt', 'recoveryStartedAt', 'lastProcessedAt', 'lastSeenAt')) {
    if ($item.$field.NULL -ne $true) { throw "Seed timestamp must initialize to null: $field" }
}
if ($item.PSObject.Properties.Name -contains 'activeIncidentId') { throw 'Seed must not create an active incident.' }

$global:FreshGuardSeedMockExitCode = 0
$global:FreshGuardSeedMockResponse = ''
$global:FreshGuardSeedMockCalls = @()
function aws {
    $global:FreshGuardSeedMockCalls += ,@($args)
    $global:LASTEXITCODE = $global:FreshGuardSeedMockExitCode
    if ($global:FreshGuardSeedMockResponse) { Write-Output $global:FreshGuardSeedMockResponse }
}

$created = & $seedPath -Region 'ap-south-1' -Profile 'test-profile'
if ($created -notmatch 'Created demo device') { throw 'First seed must report creation.' }
$firstCall = $global:FreshGuardSeedMockCalls[0]
if ($firstCall[0] -ne 'dynamodb' -or $firstCall[1] -ne 'put-item' -or
    $firstCall[3] -ne 'FreshGuardDevices-dev' -or
    $firstCall[7] -ne 'attribute_not_exists(deviceId)' -or
    $firstCall -notcontains 'test-profile') { throw 'Seed command must be conditional and restricted to the dev device table.' }

$global:FreshGuardSeedMockExitCode = 254
$global:FreshGuardSeedMockResponse = 'An error occurred (ConditionalCheckFailedException)'
$existing = & $seedPath -Region 'ap-south-1'
if ($existing -notmatch 'state preserved') { throw 'Rerun must preserve existing state.' }
if ($global:FreshGuardSeedMockCalls.Count -ne 2) { throw 'Rerun must not issue a reset/update fallback.' }

$global:FreshGuardSeedMockResponse = 'AccessDeniedException'
$failed = $false
try { & $seedPath -Region 'ap-south-1' | Out-Null } catch { $failed = $true }
if (-not $failed) { throw 'Unexpected AWS failures must fail the seed.' }

$callCount = $global:FreshGuardSeedMockCalls.Count
& $seedPath -Region 'ap-south-1' -DryRun | Out-Null
if ($global:FreshGuardSeedMockCalls.Count -ne $callCount) { throw 'Dry run must not call AWS.' }

$policy = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'iot-demo-policy.json') -Raw | ConvertFrom-Json
if ($policy.Statement.Count -ne 2 -or $policy.Statement[0].Action -ne 'iot:Connect' -or
    $policy.Statement[1].Action -ne 'iot:Publish' -or
    $policy.Statement[0].Resource -notlike '*:client/freshguard-simulator-cold-room-01' -or
    $policy.Statement[1].Resource -notlike '*:topic/freshguard/dev/devices/cold-room-01/telemetry' -or
    ($policy.Statement.Resource | Where-Object { $_.Contains('*') }).Count) {
    throw 'IoT policy must restrict Connect and Publish to the expected client/topic.'
}
Write-Output 'PASS: seed create/rerun/failure/dry-run checks; local script/runbook syntax and IoT policy restrictions.'
