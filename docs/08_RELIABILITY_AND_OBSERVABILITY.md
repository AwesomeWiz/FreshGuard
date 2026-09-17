# Reliability and Observability

## 1. Reliability objective

The demo must remain correct under the failures most likely to occur during a four-day serverless project: duplicates, stale events, downstream AI failure, notification retries, malformed telemetry and transient API errors.

## 2. Reliability properties

### R1 — incident detection is independent of Bedrock

If Bedrock times out/errors, the incident still exists and the notification path still executes.

### R2 — one continuous excursion maps to one active incident

Repeated bad readings update the active incident.

### R3 — duplicate event is safe

Processing the same `eventId` twice must not produce a second business transition.

### R4 — old readings do not rewind state

Persist for history if useful, but do not use an observation older than `lastProcessedAt` to change current monitoring state.

### R5 — incident evidence is durable

AI output can be missing; deterministic evidence cannot be missing after a successful incident-open operation.

## 3. Structured logging standard

Each Lambda log entry should be a JSON object where practical:

```json
{
  "level": "INFO",
  "operation": "evaluate_telemetry",
  "eventId": "...",
  "deviceId": "cold-room-01",
  "incidentId": "inc_...",
  "fromState": "WATCHING",
  "toState": "ACTIVE",
  "result": "incident_opened"
}
```

## 4. Essential log events

Telemetry Handler:

- `telemetry_received`
- `telemetry_validation_failed`
- `telemetry_duplicate`
- `telemetry_stale`
- `state_transition`
- `incident_opened`
- `incident_updated`
- `incident_resolved`
- `eventbridge_dispatch_failed`

Alert Handler:

- `alert_received`
- `alert_already_sent`
- `alert_sent`
- `alert_failed`

Enricher:

- `enrichment_started`
- `bedrock_succeeded`
- `bedrock_failed`
- `enrichment_saved`

API:

- request route/status/latency without sensitive payloads.

## 5. Metrics

P0 can rely on built-in Lambda metrics and logs. If time allows, add custom metrics:

- `IncidentsOpened`
- `IncidentsResolved`
- `TelemetryValidationFailures`
- `BedrockEnrichmentFailures`
- `AlertFailures`

Do not let custom metrics delay P0.

## 6. CloudWatch dashboard/demo value

A simple CloudWatch view showing Lambda invocations/errors plus structured logs is enough to demonstrate operational visibility. Do not build an elaborate ops dashboard before the product dashboard is stable.

## 7. Retry behavior

### IoT -> Lambda

AWS IoT invokes Lambda asynchronously. Handler code must therefore be safe to retry.

### EventBridge consumers

Consumers should be idempotent by `incidentId` because asynchronous services may retry delivery.

## 8. Dead-letter queues

DLQs/SQS are P1/P2. If added, document exactly which failure they address. Do not add them solely for architecture-diagram density.

## 9. Bedrock timeout budget

The dashboard should not block waiting synchronously for AI. It can first render:

```text
AI explanation: Generating…
```

then show `READY` or `FAILED` on later polling.

## 10. Graceful UI behavior

- API unavailable: show retry banner and retain last successful data if easy.
- AI failed: show evidence + “AI explanation unavailable”.
- stale device: show last seen time rather than pretending values are current.
- no incidents: show a clear empty state.

## 11. Demo reliability checklist

Before recording:

- reset device state to NORMAL;
- ensure no active incident remains;
- verify SNS subscription is confirmed;
- verify Bedrock model access;
- verify Amplify/API CORS;
- open CloudWatch log group;
- run complete scenario at least three consecutive times;
- run once with Bedrock intentionally disabled/failing and verify core behavior;
- remove test incidents or clearly select latest incident.
