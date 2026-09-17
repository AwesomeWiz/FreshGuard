# Data Model

## 1. Database strategy

Use three DynamoDB tables for hackathon clarity:

1. `FreshGuardDevices-{stage}`
2. `FreshGuardTelemetry-{stage}`
3. `FreshGuardIncidents-{stage}`

This is intentionally simpler to explain and implement than a clever single-table design.

## 2. Devices table

### Key

```text
PK: deviceId (String)
```

### Example

```json
{
  "deviceId": "cold-room-01",
  "displayName": "Cold Room 01",
  "monitoringState": "ACTIVE",
  "maxTemperatureC": 8,
  "breachGraceSeconds": 20,
  "recoveryGraceSeconds": 15,
  "staleAfterSeconds": 20,
  "activeIncidentId": "inc_01J...",
  "breachStartedAt": "2026-09-17T10:15:08.000Z",
  "recoveryStartedAt": null,
  "lastProcessedAt": "2026-09-17T10:15:35.000Z",
  "lastSeenAt": "2026-09-17T10:15:35.000Z",
  "latest": {
    "temperatureC": 9.4,
    "humidityPct": 66,
    "doorState": "OPEN",
    "powerState": "ON",
    "eventId": "..."
  },
  "version": 18
}
```

### Access patterns

- get current device state by ID;
- list demo devices (Scan acceptable for 1–few demo devices; production would model this differently);
- conditional state update.

## 3. Telemetry table

### Key

Recommended:

```text
PK: deviceId
SK: sampleKey = "{observedAt}#{eventId}"
```

ISO-8601 UTC timestamps sort lexicographically when consistently formatted.

### Example

```json
{
  "deviceId": "cold-room-01",
  "sampleKey": "2026-09-17T10:15:35.000Z#7bc...",
  "eventId": "7bc...",
  "observedAt": "2026-09-17T10:15:35.000Z",
  "receivedAt": "2026-09-17T10:15:35.421Z",
  "temperatureC": 9.4,
  "humidityPct": 66,
  "doorState": "OPEN",
  "powerState": "ON",
  "ttl": 1789...
}
```

### Retention

For the hackathon, set TTL to approximately 7 days unless a shorter period is preferable. TTL is a cleanup mechanism and should not be relied on for immediate deletion.

### Access patterns

- query recent telemetry for one device between timestamps;
- query last N samples using descending sort/limit.

## 4. Incidents table

### Primary key

```text
PK: incidentId
```

### GSI for device history

```text
GSI1PK: deviceId
GSI1SK: openedAt
```

Suggested index name: `ByDeviceOpenedAt`.

### Example

```json
{
  "incidentId": "inc_01J...",
  "deviceId": "cold-room-01",
  "status": "OPEN",
  "openedAt": "2026-09-17T10:15:30.000Z",
  "resolvedAt": null,
  "breachStartedAt": "2026-09-17T10:15:08.000Z",
  "thresholdC": 8,
  "breachGraceSeconds": 20,
  "recoveryGraceSeconds": 15,
  "temperatureAtOpenC": 9.2,
  "latestTemperatureC": 9.4,
  "peakTemperatureC": 9.4,
  "doorStateAtOpen": "OPEN",
  "powerStateAtOpen": "ON",
  "notificationStatus": "SENT",
  "notificationSentAt": "2026-09-17T10:15:31.000Z",
  "aiStatus": "READY",
  "aiExplanation": "...",
  "aiGeneratedAt": "2026-09-17T10:15:33.000Z",
  "durationSeconds": null,
  "eventDispatchStatus": "SENT"
}
```

## 5. Why not store everything in one JSON blob

Separate top-level fields make:

- API responses straightforward;
- conditional updates possible;
- incident evidence inspectable;
- tests simpler;
- CloudWatch/debugging easier.

## 6. Concurrency strategy

The Devices item may use a numeric `version` and conditional expression:

```text
SET ... version = version + 1
CONDITION version = :expectedVersion
```

or conditional checks on `lastProcessedAt` and `activeIncidentId`.

For hackathon scale, retry a small number of conditional conflicts with a fresh read. Do not silently overwrite newer state.

## 7. Telemetry idempotency

Because `eventId` is included in `sampleKey`, an exact duplicate can be rejected with:

```text
ConditionExpression: attribute_not_exists(sampleKey)
```

A duplicate write should be logged as expected deduplication, not a system failure.

## 8. Incident update semantics

While OPEN, update only monotonic/current fields:

- `latestTemperatureC`;
- `peakTemperatureC`;
- latest observed contextual signals if desired.

On resolution set:

- `status = RESOLVED`;
- `resolvedAt`;
- `durationSeconds`.

Do not mutate the opening evidence fields.

## 9. API DTOs vs raw DynamoDB items

Do not return DynamoDB internal representations directly. Map to stable API DTOs so storage decisions can change without breaking the UI.
