# Create-only dev seed. Existing device configuration/state is never reset.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Region,
    [string]$Profile,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$itemPath = Join-Path $PSScriptRoot 'demo-device-item.json'
$tableName = 'FreshGuardDevices-dev'
$awsArguments = @(
    'dynamodb', 'put-item',
    '--table-name', $tableName,
    '--item', "file://$itemPath",
    '--condition-expression', 'attribute_not_exists(deviceId)',
    '--region', $Region,
    '--no-cli-pager'
)
if ($Profile) { $awsArguments += @('--profile', $Profile) }

if ($DryRun) {
    Write-Output "Would create cold-room-01 in $tableName ($Region) only if absent."
    Get-Content -LiteralPath $itemPath -Raw
    return
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI v2 is required. Install it and authenticate before seeding.'
}

# Capture CLI errors so expected reruns are controlled; never print raw responses.
# Continue allows Windows PowerShell to capture native stderr before checking exit.
$previousErrorPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $response = & aws @awsArguments 2>&1
    $awsExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorPreference
}
if ($awsExitCode -eq 0) {
    Write-Output "Created demo device cold-room-01 in $tableName. Demo thresholds only."
} elseif (($response | Out-String) -match 'ConditionalCheckFailedException') {
    Write-Output 'Device cold-room-01 already exists; configuration and monitoring state preserved.'
} else {
    throw 'Device seed failed. Check AWS identity, region, table deployment and PutItem permission.'
}
