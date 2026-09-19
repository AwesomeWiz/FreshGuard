# Day-1 IoT routing, seed and deployment preparation

Run these commands from the repository root in PowerShell. This document prepares
the actions; it does not mean any AWS resources have been created. Deployment,
device seeding and certificate provisioning require explicit user approval before
the coding agent executes them. Install AWS CLI v2 and SAM CLI, authenticate with
your development identity, and choose one AWS Region. No credentials belong here.

## Local checks and deployment

The SAM template includes one stage-aware rule. For `Stage=dev`, its name is
`freshguard_dev_telemetry` and SQL is exactly
`SELECT * FROM 'freshguard/dev/devices/+/telemetry'`, version `2016-03-23`.
Stage hyphens become underscores in rule names only; MQTT topics retain Stage.
The Lambda permission restricts both the specific rule ARN and current account.
The rule depends on that permission, so it cannot be enabled before permission
creation. No IoT Thing or certificate is managed by this stack.

```powershell
cmd.exe /d /c pnpm install --frozen-lockfile
cmd.exe /d /c pnpm --filter @freshguard/contracts test
cmd.exe /d /c pnpm --filter @freshguard/domain test
cmd.exe /d /c pnpm --filter @freshguard/telemetry-handler test
cmd.exe /d /c pnpm --filter @freshguard/telemetry-handler typecheck
cmd.exe /d /c pnpm --filter @freshguard/telemetry-handler build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-seed-demo-device.ps1
sam validate --template-file infrastructure/template.yaml
sam build --template-file infrastructure/template.yaml
```

Build the handler before every SAM build: SAM packages the existing esbuild
`dist/` bundle using `SkipBuild`. If basic validation requires AWS identity/region,
`sam validate --lint --template-file infrastructure/template.yaml` performs local
template linting. This does not replace a deployed smoke test.

After approval, set your region, review the template/IAM and run guided deployment:

```powershell
$awsRegion = Read-Host 'AWS Region selected for FreshGuard'
$samConfigPath = Join-Path $PWD 'infrastructure/samconfig.toml'
sam deploy --guided --template-file .aws-sam/build/template.yaml --region $awsRegion --config-file $samConfigPath
```

Use `Stage=dev`, enable confirmation of changes, review the change set, acknowledge
the scoped IAM role, and save settings to `infrastructure/samconfig.toml`. This file
may contain stack/region/stage/build settings, never credentials. It is generated
by the first approved guided deployment, not prefilled with guessed account values.
Record the chosen stack name for the verification commands below.

## Create-only demo device seed

The checked-in JSON uses DynamoDB attribute types for AWS CLI `--item`. The
PowerShell script seeds only `cold-room-01` in `FreshGuardDevices-dev`: NORMAL,
version 0, null state timestamps, and no incident pointer. Values 8 degrees C,
20-second breach grace, 15-second recovery grace and 20-second stale timing are
demo configuration, not universal safety thresholds.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/seed-demo-device.ps1 -Region $awsRegion -DryRun
```

After approval and stack deployment, remove `-DryRun` to create the device. Add
`-Profile your-profile-name` if using a named AWS CLI profile. The default AWS
credential chain is otherwise used. The script condition is
`attribute_not_exists(deviceId)`; reruns preserve all existing configuration,
version and monitoring state. Other AWS failures cause a non-success exit.
It does not reset an active device. The seed identity needs `dynamodb:PutItem`
only on the dev Devices table; the Lambda role is not used for seeding.

## One-time IoT provisioning — execute only after approval

These CLI steps provision one Thing and one active certificate. Run them in order
and stop on errors. On interrupted setup, resume from the last completed step;
do not rerun certificate creation. Existing local material causes that step to
stop, preventing accidental replacement. Review any existing cloud policy before
reusing it; do not attach an unreviewed existing policy on a create-policy error.

Set the region as above. This helper stops on AWS CLI failure; its certificate
call projects only the certificate ARN so key/certificate contents never reach
terminal output. Do not add `--debug` or remove that projection.

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-Aws {
    $cliResult = & aws @args --region $awsRegion --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw 'AWS command failed; stop and inspect the completed step.' }
    return $cliResult
}
$identityArn = Invoke-Aws sts get-caller-identity --query Arn --output text
$awsPartition = ($identityArn -split ':')[1]
$awsAccountId = Invoke-Aws sts get-caller-identity --query Account --output text
$certDirectory = Join-Path $PWD '.simulator-certs'
New-Item -ItemType Directory -Path $certDirectory -Force | Out-Null
if ((Get-Item -LiteralPath $certDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw '.simulator-certs must be a real local directory, not a redirected path.'
}
Invoke-Aws iot create-thing --thing-name cold-room-01 | Out-Null

$policyTemplate = Get-Content -LiteralPath scripts/iot-demo-policy.json -Raw
$policyDocument = $policyTemplate.Replace('${AWS_PARTITION}', $awsPartition).Replace('${AWS_REGION}', $awsRegion).Replace('${AWS_ACCOUNT_ID}', $awsAccountId)
$policyPath = Join-Path $certDirectory 'iot-policy.json'
Set-Content -LiteralPath $policyPath -Value $policyDocument -Encoding ASCII
Invoke-Aws iot create-policy --policy-name freshguard_dev_cold_room_01 --policy-document "file://$policyPath" | Out-Null
```

The policy permits only `iot:Connect` for
`freshguard-simulator-cold-room-01` and `iot:Publish` to
`freshguard/dev/devices/cold-room-01/telemetry` in the selected account/region.
It contains no wildcard resource/action and no Subscribe/Receive permission.

```powershell
$deviceCertificatePath = Join-Path $certDirectory 'device.pem.crt'
$devicePrivateKeyPath = Join-Path $certDirectory 'private.pem.key'
if ((Test-Path -LiteralPath $deviceCertificatePath) -or (Test-Path -LiteralPath $devicePrivateKeyPath)) {
    throw 'Device material already exists. Resume attachment with the saved certificate ARN; do not replace it.'
}
$certificateArn = Invoke-Aws iot create-keys-and-certificate --set-as-active --certificate-pem-outfile $deviceCertificatePath --private-key-outfile $devicePrivateKeyPath --query certificateArn --output text
Set-Content -LiteralPath (Join-Path $certDirectory 'certificate-arn.txt') -Value $certificateArn -Encoding ASCII
Invoke-Aws iot attach-thing-principal --thing-name cold-room-01 --principal $certificateArn | Out-Null
Invoke-Aws iot attach-policy --policy-name freshguard_dev_cold_room_01 --target $certificateArn | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri 'https://www.amazontrust.com/repository/AmazonRootCA1.pem' -OutFile (Join-Path $certDirectory 'AmazonRootCA1.pem')
$iotEndpoint = Invoke-Aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text
Write-Output "Region: $awsRegion"
Write-Output "IoT ATS endpoint: $iotEndpoint"
Write-Output 'MQTT topic: freshguard/dev/devices/cold-room-01/telemetry'
Write-Output 'MQTT client ID: freshguard-simulator-cold-room-01'
```

To resume attachments in a later shell, restore the region/helper and read the ARN
from `.simulator-certs/certificate-arn.txt`. ARN metadata is not private key material.
Keep all generated files local. `.gitignore` already covers `.simulator-certs/`,
`*.pem.key`, and `*.pem.crt`. Never commit, print or paste file contents, and do not
place these files in CloudFormation parameters/outputs. The root CA is also kept
under `.simulator-certs/` for a single local simulator configuration location.

## Verify after deployment and provisioning

No script/runbook preparation proves cloud resources exist. After approved
execution, use these read-only checks with your selected stack name:

```powershell
$stackName = Read-Host 'Deployed FreshGuard stack name'
Invoke-Aws cloudformation describe-stacks --stack-name $stackName --query 'Stacks[0].Outputs' --output table
Invoke-Aws iot get-topic-rule --rule-name freshguard_dev_telemetry
Invoke-Aws lambda get-policy --function-name freshguard-dev-telemetry-handler
Invoke-Aws iot describe-certificate --certificate-id (($certificateArn -split '/')[-1]) --query 'certificateDescription.{status:status,arn:certificateArn}'
Invoke-Aws iot list-thing-principals --thing-name cold-room-01
Invoke-Aws iot list-attached-policies --target $certificateArn
Invoke-Aws dynamodb get-item --table-name FreshGuardDevices-dev --key file://scripts/demo-device-key.json --consistent-read
```

For a later ingestion smoke test, publish one contract-valid sample through MQTT
with the provisioned simulator identity, then inspect `telemetry_received`,
`state_transition` and the corresponding Telemetry/Devices records. Simulator
implementation is outside this task. Republish the exact event to verify a
controlled duplicate; publish an older event to verify no state rewind.

Non-secret teammate configuration available after execution:

| Value | Source/value |
| --- | --- |
| Region | Your selected region |
| IoT endpoint | `describe-endpoint --endpoint-type iot:Data-ATS` |
| Topic | `freshguard/dev/devices/cold-room-01/telemetry` |
| Client ID | `freshguard-simulator-cold-room-01` |
| Certificate path | `.simulator-certs/device.pem.crt` |
| Private-key path | `.simulator-certs/private.pem.key` |
| Root CA path | `.simulator-certs/AmazonRootCA1.pem` |

Paths are local to the repository root; use `../.simulator-certs/...` when running
from `simulator/`. Share paths and non-secret values only, not file contents.
