# Technical Design Document (TDD)

## 1. Purpose

This document defines the implementation architecture for FreshGuard v0. It prioritizes a reliable four-day implementation over maximum extensibility.

## 2. System overview

FreshGuard is an event-driven AWS serverless application. A Python simulator acts as a software-defined IoT device and publishes telemetry over MQTT/TLS to AWS IoT Core. An IoT Rule asynchronously invokes a Lambda telemetry handler. The handler validates the payload, persists telemetry, advances a deterministic device state machine, creates/updates incidents, and emits incident domain events to EventBridge. Independent consumers handle SNS notification and Amazon Bedrock enrichment. A read-only API serves the deployed Next.js dashboard.

## 3. High-level component list

| Component | Responsibility |
|---|---|
| Python simulator | Publish deterministic MQTT telemetry scenarios |
| AWS IoT Core | Secure MQTT endpoint and ingestion |
| IoT Topic Rule | Route matching telemetry to Lambda |
| Telemetry Handler Lambda | Validate, dedupe, persist, evaluate state, update/create/resolve incident |
| DynamoDB Telemetry table | Recent time-series samples with TTL |
| DynamoDB Devices table | Latest state, config and monitoring state |
| DynamoDB Incidents table | Durable incident records/history |
| EventBridge custom bus/default bus | Route incident domain events |
| Alert Handler Lambda | Format/publish SNS opening alert |
| SNS | Deliver email/SMS-compatible alert channel used in demo |
| Incident Enricher Lambda | Build evidence prompt, call Bedrock, persist explanation |
| Amazon Bedrock | Human-readable grounded explanation |
| API Lambda | Read-only REST/HTTP endpoints |
| API Gateway | Public HTTP interface for dashboard |
| Next.js dashboard | Visualize state, chart and incidents |
| Amplify Hosting | Deploy dashboard URL |
| CloudWatch | Logs, metrics and operational inspection |
| AWS SAM | Infrastructure as code |

## 4. Technology decisions

### Runtime

- Lambda: TypeScript compiled for Node.js 22.x.
- Frontend: TypeScript/Next.js.
- Simulator: Python 3.12+.

Node.js 22 is currently a supported AWS Lambda runtime and fits the team's existing Node >=22 environment.

### Infrastructure as code

AWS SAM/CloudFormation is selected instead of manual-only console configuration because it improves reproducibility and gives judges a clear architecture artifact. Some one-time IoT certificate provisioning may still use AWS CLI/console because device certificates contain local secret material.

### DynamoDB rather than relational database

Access patterns are simple, traffic is small/bursty, serverless deployment is desired, and the project does not require joins or relational reporting.

### EventBridge fan-out

Incident detection publishes domain events rather than directly sequencing all downstream operations. This keeps alerting and AI enrichment independent.

### No queue in P0

SQS is technically reasonable for stronger retry isolation but is not required for the four-day core. Add only if a demonstrated failure mode justifies it and P0 is complete.

## 5. Critical event flow

1. Simulator publishes to `freshguard/{stage}/devices/{deviceId}/telemetry`.
2. IoT Core authenticates the simulator certificate and accepts the MQTT message.
3. IoT Topic Rule invokes Telemetry Handler Lambda asynchronously.
4. Handler validates schema and supported device ID.
5. Handler performs an idempotent telemetry write keyed by device/time/event.
6. Handler loads device monitoring/config state.
7. Pure domain function computes the next state and optional domain action.
8. Handler conditionally updates device state.
9. If incident opens, handler writes an OPEN incident and emits `freshguard.incident.opened`.
10. EventBridge independently invokes Alert Handler and Incident Enricher.
11. Alert Handler publishes SNS notification.
12. Incident Enricher calls Bedrock and updates AI fields on the incident.
13. Dashboard polls the read API every few seconds during the demo.
14. When telemetry recovers for the configured interval, handler resolves the incident and emits `freshguard.incident.resolved`.

## 6. Domain state transition algorithm

Domain logic must be implemented in a pure function with no AWS calls.

Inputs:

```ts
interface EvaluationInput {
  previous: DeviceMonitoringState;
  reading: TelemetryReading;
  config: DeviceConfig;
}
```

Output:

```ts
interface EvaluationResult {
  next: DeviceMonitoringState;
  action:
    | { type: 'NONE' }
    | { type: 'OPEN_INCIDENT'; openedAt: string }
    | { type: 'UPDATE_INCIDENT' }
    | { type: 'RESOLVE_INCIDENT'; resolvedAt: string };
}
```

Rules are fully specified in `04_DOMAIN_AND_STATE_MACHINE.md`.

## 7. Idempotency design

### Telemetry

Every message has a UUID `eventId`. The Telemetry table item ID includes the event ID and the handler uses a conditional write. A duplicate event becomes a no-op for telemetry storage.

### Incident opening

The Devices item carries `activeIncidentId` and monitoring state. A conditional update prevents a second OPEN incident from being created when one is already active.

Implementation may use `TransactWriteItems` for the device-state + incident-open write if time permits. If transactions add too much risk, use a conditional device update first and only the successful winner creates the incident. Document the chosen mechanism.

### SNS

Normal deduplication comes from emitting one `incident.opened` domain event. The Alert Handler records `notificationStatus` / `notificationSentAt` on the incident. It should use a conditional update so retries do not intentionally republish after a successful send.

### Bedrock

AI enrichment is keyed by incident ID. A retry replaces/sets the same fields rather than creating a new object.

## 8. Ordering

MQTT/Iot/Lambda processing should not be assumed to be a globally ordered distributed log.

For the hackathon:

- each telemetry item carries `observedAt`;
- device state stores `lastProcessedAt`;
- a reading older than `lastProcessedAt` can be persisted for history but must not rewind current device state;
- equal timestamps are disambiguated using `eventId` only for storage.

The simulator generates monotonically increasing UTC timestamps, so the normal demo path is simple.

## 9. Bedrock design

### What the model receives

A compact JSON evidence object, for example:

```json
{
  "deviceId": "cold-room-01",
  "incidentId": "inc_...",
  "openedAt": "2026-09-17T10:15:30Z",
  "thresholdC": 8,
  "graceSeconds": 20,
  "temperatureAtOpenC": 9.4,
  "peakTemperatureC": 9.4,
  "doorState": "OPEN",
  "powerState": "ON",
  "breachDurationSeconds": 22
}
```

### System/prompt constraints

The prompt must instruct the model to:

- summarize only supplied observations;
- avoid claiming the food is safe/unsafe;
- avoid claiming a proven causal root cause;
- phrase correlations as observations (e.g. "the door was reported open while temperature was elevated");
- provide 2–4 concise sentences;
- recommend checking the equipment/door only as an operational next step, not as a safety certification.

### Failure behavior

On failure:

```text
aiStatus = FAILED
aiExplanation = null
```

The API and UI still display the incident evidence.

## 10. API approach

The dashboard API is read-only in P0. No mutation endpoints are needed because the simulator publishes directly to MQTT.

Recommended routes:

```text
GET /health
GET /devices
GET /devices/{deviceId}
GET /devices/{deviceId}/telemetry?minutes=30&limit=300
GET /devices/{deviceId}/incidents?limit=10
GET /incidents/{incidentId}
```

CORS should allow the deployed Amplify origin plus localhost during development.

## 11. Frontend update strategy

P0 uses polling rather than WebSockets.

Recommended intervals during demo:

- device/latest state: 2–3 seconds;
- telemetry chart: 3–5 seconds;
- incidents: 3–5 seconds.

Reason: simpler, more reliable in four days, and sufficient for a three-minute demo.

Do not add AppSync/WebSocket infrastructure unless P0 is finished and stable.

## 12. Deployment architecture

### Backend

`sam build` and `sam deploy` deploy:

- DynamoDB tables;
- Lambda functions;
- API Gateway;
- EventBridge rules;
- SNS topic;
- IoT Topic Rule;
- IAM roles/policies;
- CloudWatch log configuration where supported.

### Device certificate

Provision separately and save under a gitignored local folder such as:

```text
.simulator-certs/
  device.pem.crt
  private.pem.key
  AmazonRootCA1.pem
```

Never place certificate/private-key material in `/docs`, repository history, screenshots, or demo video.

### Frontend

Amplify builds `apps/web` from GitHub. Public environment variable contains only the API base URL, not secrets.

## 13. Environment configuration

Suggested variables:

### Lambda

```text
STAGE
DEVICES_TABLE
TELEMETRY_TABLE
INCIDENTS_TABLE
EVENT_BUS_NAME
SNS_TOPIC_ARN
BEDROCK_MODEL_ID
LOG_LEVEL
```

Only functions needing a value should receive it.

### Web

```text
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_DEMO_DEVICE_ID=cold-room-01
```

### Simulator

```text
AWS_IOT_ENDPOINT
AWS_IOT_CLIENT_ID
AWS_IOT_TOPIC
AWS_IOT_CERT_PATH
AWS_IOT_PRIVATE_KEY_PATH
AWS_IOT_ROOT_CA_PATH
DEVICE_ID
```

Use a local `.env` that is ignored by Git.

## 14. Error handling

### Invalid telemetry

- log `validation_failed`;
- do not write state/incident;
- Lambda returns/fails according to chosen async retry policy;
- avoid infinite noisy retries for permanently invalid payloads.

### DynamoDB conditional conflict

Treat expected idempotency conflicts as controlled no-ops. Log them as `duplicate_or_stale_event`, not system errors.

### EventBridge failure

The telemetry handler should treat inability to emit an incident domain event as a real operational error. The incident record must remain persisted with an `eventDispatchStatus` or logs sufficient to retry manually during development.

### SNS failure

Log and mark notification failure. Do not delete/rollback the incident.

### Bedrock failure

Mark enrichment failed. Never roll back the incident.

### API read failure

Return structured error JSON and render a dashboard error/refresh state rather than a blank screen.

## 15. Security boundaries

- IoT simulator authenticates with an X.509 certificate and an IoT policy restricted to its topic/client where practical.
- Lambda uses execution roles with specific table/event/topic/model permissions.
- Public API exposes no device-control or database mutation operation.
- Bedrock model calls happen only server-side.
- private keys never reach Amplify/frontend.

Detailed policies are in `07_SECURITY_AND_IAM.md`.

## 16. Scalability discussion for judges/interviews

The hackathon implementation is intentionally small, but the architecture has natural scale points:

- IoT Core handles device ingress;
- Lambda scales per event;
- DynamoDB on-demand handles variable write/read volume;
- EventBridge decouples downstream consumers;
- Bedrock runs only on incident transitions rather than every sample.

At larger scale, likely additions would include batching/downsampling telemetry, a purpose-built time-series store, SQS/DLQs, per-tenant authorization, device provisioning workflows, stronger state concurrency controls, tracing and operational dashboards. These are future considerations, not hidden P0 requirements.

## 17. Explicit trade-offs

| Decision | Benefit | Cost/trade-off |
|---|---|---|
| Polling UI | Fast/simple/reliable | Not true push realtime |
| 3 DynamoDB tables | Clear access patterns | More resources than single-table design |
| Bedrock per incident | Low cost + grounded context | Explanation is not continuous |
| Software simulator | No hardware risk | Does not prove sensor calibration/in-field networking |
| No Cognito P0 | Faster demo | Public read-only demo API |
| No SQS P0 | Less implementation risk | Less retry isolation |
| Configurable threshold | Honest/general | Demo value must be explained as configuration |

## 18. Definition of technically complete

The backend is technically complete when automated/unit tests pass and an end-to-end test proves:

```text
MQTT telemetry
-> IoT Rule
-> Lambda
-> DynamoDB
-> OPEN incident
-> EventBridge
-> SNS + Bedrock consumers
-> API
-> Amplify dashboard
-> RESOLVED incident
```

with a deliberate Bedrock failure test proving the detection/alert path remains functional.
