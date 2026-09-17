# Event and API Contracts

## 1. Contract policy

Contracts are versioned conceptually from day one. P0 uses `schemaVersion: 1` in asynchronous payloads.

All timestamps are UTC ISO-8601 strings.

## 2. MQTT topic

```text
freshguard/{stage}/devices/{deviceId}/telemetry
```

Example:

```text
freshguard/dev/devices/cold-room-01/telemetry
```

## 3. Telemetry payload

```json
{
  "schemaVersion": 1,
  "eventId": "4dbfa4e7-...",
  "deviceId": "cold-room-01",
  "observedAt": "2026-09-17T10:15:35.000Z",
  "temperatureC": 9.4,
  "humidityPct": 66.0,
  "doorState": "OPEN",
  "powerState": "ON"
}
```

### Validation

Required:

- `schemaVersion === 1`
- valid UUID-like unique event ID (strict UUID optional if implementation time is limited)
- expected device ID format
- parseable UTC timestamp
- finite temperature number in a broad plausible technical range such as `-100..200` solely for malformed-data protection, not domain safety

Optional:

- humidity in `0..100`
- door state enum
- power state enum

## 4. EventBridge event: incident opened

Event envelope fields should use AWS EventBridge conventions:

```text
source: freshguard.incidents
detail-type: freshguard.incident.opened
```

Detail:

```json
{
  "schemaVersion": 1,
  "incidentId": "inc_01J...",
  "deviceId": "cold-room-01",
  "openedAt": "2026-09-17T10:15:30.000Z",
  "breachStartedAt": "2026-09-17T10:15:08.000Z",
  "thresholdC": 8,
  "breachGraceSeconds": 20,
  "temperatureAtOpenC": 9.2,
  "peakTemperatureC": 9.2,
  "doorState": "OPEN",
  "powerState": "ON"
}
```

Consumers must treat the incident ID as the idempotency/business key.

## 5. EventBridge event: incident resolved

```text
source: freshguard.incidents
detail-type: freshguard.incident.resolved
```

Detail:

```json
{
  "schemaVersion": 1,
  "incidentId": "inc_01J...",
  "deviceId": "cold-room-01",
  "openedAt": "2026-09-17T10:15:30.000Z",
  "resolvedAt": "2026-09-17T10:18:10.000Z",
  "durationSeconds": 160,
  "peakTemperatureC": 10.4
}
```

## 6. Read API

### `GET /health`

Response:

```json
{
  "status": "ok",
  "service": "freshguard-api"
}
```

### `GET /devices`

For the demo this can return the configured demo devices.

```json
{
  "items": [
    {
      "deviceId": "cold-room-01",
      "displayName": "Cold Room 01",
      "monitoringState": "NORMAL",
      "lastSeenAt": "...",
      "latestTemperatureC": 4.3
    }
  ]
}
```

### `GET /devices/{deviceId}`

```json
{
  "deviceId": "cold-room-01",
  "displayName": "Cold Room 01",
  "monitoringState": "ACTIVE",
  "presentationState": "INCIDENT",
  "configuration": {
    "maxTemperatureC": 8,
    "breachGraceSeconds": 20,
    "recoveryGraceSeconds": 15,
    "staleAfterSeconds": 20
  },
  "latest": {
    "observedAt": "...",
    "temperatureC": 9.4,
    "humidityPct": 66,
    "doorState": "OPEN",
    "powerState": "ON"
  },
  "activeIncidentId": "inc_..."
}
```

### `GET /devices/{deviceId}/telemetry?minutes=30&limit=300`

```json
{
  "deviceId": "cold-room-01",
  "items": [
    {
      "observedAt": "...",
      "temperatureC": 4.3,
      "humidityPct": 64,
      "doorState": "CLOSED",
      "powerState": "ON"
    }
  ]
}
```

Server must cap `minutes` and `limit` to avoid accidental unbounded reads.

### `GET /devices/{deviceId}/incidents?limit=10`

```json
{
  "deviceId": "cold-room-01",
  "items": [
    {
      "incidentId": "inc_...",
      "status": "RESOLVED",
      "openedAt": "...",
      "resolvedAt": "...",
      "peakTemperatureC": 10.4,
      "durationSeconds": 160,
      "aiStatus": "READY"
    }
  ]
}
```

### `GET /incidents/{incidentId}`

Returns full evidence and enrichment.

## 7. API error shape

```json
{
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device was not found",
    "requestId": "..."
  }
}
```

Do not expose AWS exception messages or stack traces publicly.

## 8. Simulator scenario contract

Scenario files can be declarative JSON/YAML or code. A simple P0 structure:

```json
{
  "name": "door-open-excursion",
  "tickSeconds": 2,
  "steps": [
    {"temperatureC": 4.4, "doorState": "CLOSED", "powerState": "ON"},
    {"temperatureC": 6.0, "doorState": "OPEN", "powerState": "ON"},
    {"temperatureC": 8.4, "doorState": "OPEN", "powerState": "ON"},
    {"temperatureC": 9.2, "doorState": "OPEN", "powerState": "ON"},
    {"temperatureC": 10.1, "doorState": "OPEN", "powerState": "ON"}
  ]
}
```

The simulator generates fresh `eventId` and `observedAt` values at runtime.
