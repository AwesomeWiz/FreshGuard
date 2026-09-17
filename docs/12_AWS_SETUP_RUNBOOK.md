# AWS Setup and Deployment Runbook

## 1. Purpose

This is an implementation runbook, not a substitute for AWS security documentation. Prefer infrastructure as code and record any necessary manual step.

## 2. Prerequisites

Local machine:

- Git
- Node.js 22+
- pnpm
- Python 3.12+
- AWS CLI v2
- AWS SAM CLI
- AWS account/credentials for the hackathon

No Docker requirement should be introduced into the core workflow.

## 3. Region

Choose one AWS Region where required services/model access are available and use it consistently. Do not spread this hackathon across multiple Regions.

Record selected region in project README/environment examples.

## 4. AWS identity safety

Use a normal development identity/role rather than root. Do not create long-lived credentials if avoidable. Never commit AWS credentials.

## 5. Repository setup

```bash
git clone <repo>
cd freshguard
pnpm install
```

Python simulator:

```bash
cd simulator
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 6. Backend SAM deployment

Typical flow:

```bash
sam build
sam deploy --guided
```

First guided deploy should save a `samconfig.toml` without secrets.

Expected outputs should include:

- API base URL;
- IoT telemetry topic/pattern if output is convenient;
- SNS topic ARN;
- table names.

## 7. IoT Thing and device certificate

Provision one demo thing/device such as:

```text
cold-room-01
```

Create/download:

- device certificate;
- private key;
- Amazon root CA.

Attach:

- certificate to Thing as required by chosen setup;
- restrictive IoT policy allowing connect/publish to the demo topic.

Save secret files only under `.simulator-certs/`.

Retrieve account-specific IoT data endpoint, for example using AWS CLI/console, and configure simulator `.env`.

## 8. IoT rule

The SAM stack should create a topic rule listening to:

```text
freshguard/dev/devices/+/telemetry
```

or an equivalent stage-aware filter.

It invokes the Telemetry Handler Lambda.

Verify Lambda resource-based permission allows IoT invocation.

## 9. Seed device configuration

Either SAM custom setup or a small explicit seed command should create:

```json
{
  "deviceId": "cold-room-01",
  "displayName": "Cold Room 01",
  "monitoringState": "NORMAL",
  "maxTemperatureC": 8,
  "breachGraceSeconds": 20,
  "recoveryGraceSeconds": 15,
  "staleAfterSeconds": 20,
  "version": 0
}
```

Mark values as demo configuration.

Prefer a checked-in seed script over manual console editing.

## 10. SNS subscription

Subscribe a team-controlled email endpoint to the incident topic and confirm the subscription before recording.

Do not expose personal contact details in repository screenshots.

## 11. Bedrock

1. Select a model available in the chosen region/account.
2. Verify model access/invocation from a small test.
3. Set `BEDROCK_MODEL_ID` server-side.
4. Run one real incident enrichment before integrating UI.

If the desired model is unavailable, switch model rather than redesigning the product around a specific model.

## 12. Web deployment

Deploy `apps/web` through Amplify Hosting from GitHub.

Set:

```text
NEXT_PUBLIC_API_BASE_URL=<deployed API URL>
NEXT_PUBLIC_DEMO_DEVICE_ID=cold-room-01
```

Then restrict API CORS to the Amplify origin + localhost.

## 13. Simulator configuration

Example `.env` fields:

```text
AWS_IOT_ENDPOINT=...
AWS_IOT_CLIENT_ID=freshguard-simulator-cold-room-01
AWS_IOT_TOPIC=freshguard/dev/devices/cold-room-01/telemetry
AWS_IOT_CERT_PATH=../.simulator-certs/device.pem.crt
AWS_IOT_PRIVATE_KEY_PATH=../.simulator-certs/private.pem.key
AWS_IOT_ROOT_CA_PATH=../.simulator-certs/AmazonRootCA1.pem
DEVICE_ID=cold-room-01
```

## 14. Smoke test

Run normal simulator mode and verify, in order:

1. simulator logs publish success;
2. IoT/Lambda CloudWatch logs show event;
3. Telemetry table gets sample;
4. Devices table latest state updates;
5. API returns updated device;
6. deployed dashboard displays it.

Then run breach/recovery.

## 15. Reset script

Create a safe dev-only script such as:

```text
scripts/reset-demo-state.ts
```

It may:

- set device monitoring state to NORMAL;
- clear active incident pointer;
- optionally mark stray test OPEN incidents as test/reset or delete only known dev records.

Do not expose reset as a public API route.

## 16. Teardown

After judging/when no longer needed:

```bash
sam delete
```

Also remove resources that are not part of the SAM stack, such as IoT certificates/Thing if manually created, and disconnect Amplify if desired.
