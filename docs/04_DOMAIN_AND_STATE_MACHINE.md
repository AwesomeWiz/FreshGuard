# Domain Model and Incident State Machine

## 1. Core domain language

### Telemetry reading

One observation emitted by one device at one timestamp.

### Breach reading

A reading whose temperature is above that device's configured maximum temperature.

### Excursion

A continuous period of breach readings long enough to satisfy the configured grace duration.

### Incident

The durable business record opened when an excursion satisfies the configured detection policy.

### Recovery

A continuous period at/below the configured maximum long enough to satisfy the configured recovery duration.

## 2. Why a state machine is necessary

A naïve implementation might create an alert whenever:

```text
temperature > threshold
```

If a sensor publishes every five seconds, a five-minute event could produce dozens of alerts. FreshGuard instead models a lifecycle.

## 3. Device monitoring states

```text
NORMAL
WATCHING
ACTIVE
RECOVERING
```

### NORMAL

No active breach window and no active incident.

### WATCHING

Temperature is currently above the configured maximum, but the grace duration has not yet been satisfied.

### ACTIVE

A confirmed incident exists and temperature remains above the configured maximum, or recovery was interrupted.

### RECOVERING

An active incident exists, but the temperature has returned to/below the configured maximum and is being observed for a configured recovery duration.

## 4. Transition table

| Current | Reading condition | Additional condition | Next | Business action |
|---|---|---|---|---|
| NORMAL | `temp <= max` | — | NORMAL | none |
| NORMAL | `temp > max` | — | WATCHING | set `breachStartedAt` |
| WATCHING | `temp > max` | grace not satisfied | WATCHING | update latest data |
| WATCHING | `temp > max` | grace satisfied | ACTIVE | open one incident |
| WATCHING | `temp <= max` | — | NORMAL | clear breach window |
| ACTIVE | `temp > max` | — | ACTIVE | update incident peak/latest |
| ACTIVE | `temp <= max` | — | RECOVERING | set `recoveryStartedAt` |
| RECOVERING | `temp <= max` | recovery not satisfied | RECOVERING | continue recovery |
| RECOVERING | `temp <= max` | recovery satisfied | NORMAL | resolve incident |
| RECOVERING | `temp > max` | — | ACTIVE | clear recovery window; same incident remains open |

## 5. Incident lifecycle

Incident status is deliberately simpler than device monitoring state:

```text
OPEN -> RESOLVED
```

`WATCHING` does not create an incident.

## 6. Example demo configuration

The following values exist only to make a short hackathon demo possible:

```json
{
  "maxTemperatureC": 8.0,
  "breachGraceSeconds": 20,
  "recoveryGraceSeconds": 15,
  "staleAfterSeconds": 20
}
```

These are **demo configuration values, not claimed universal food-safety standards**.

## 7. Peak calculation

While an incident is OPEN:

```text
peakTemperatureC = max(previousPeakTemperatureC, currentTemperatureC)
```

## 8. Duration

When resolved:

```text
durationSeconds = resolvedAt - openedAt
```

The record may also keep `breachStartedAt` for context, because the breach begins before the grace window opens the incident.

## 9. Supporting sensor signals

The simulator may include:

```text
doorState: OPEN | CLOSED | UNKNOWN
powerState: ON | OFF | UNKNOWN
humidityPct: optional number
```

These fields are contextual observations. They do not alter the P0 incident decision, which depends only on temperature + time configuration.

Reason: this keeps detection auditable and avoids pretending a simulated door state proves causation.

## 10. Stale/offline presentation state

P1 UI state:

```text
if now - lastSeenAt > staleAfterSeconds:
    display STALE
```

This does not create a temperature incident by itself in P0. It is a separate visibility condition.

## 11. Pure evaluator pseudocode

```text
if reading.observedAt < state.lastProcessedAt:
    persist telemetry if desired
    return NO_STATE_CHANGE

if state == NORMAL:
    if temp > max:
        -> WATCHING
        breachStartedAt = observedAt
    else:
        remain NORMAL

if state == WATCHING:
    if temp <= max:
        -> NORMAL
        clear breachStartedAt
    else if observedAt - breachStartedAt >= breachGrace:
        -> ACTIVE
        OPEN_INCIDENT
    else:
        remain WATCHING

if state == ACTIVE:
    if temp > max:
        remain ACTIVE
        UPDATE_INCIDENT_PEAK
    else:
        -> RECOVERING
        recoveryStartedAt = observedAt

if state == RECOVERING:
    if temp > max:
        -> ACTIVE
        clear recoveryStartedAt
    else if observedAt - recoveryStartedAt >= recoveryGrace:
        -> NORMAL
        RESOLVE_INCIDENT
    else:
        remain RECOVERING
```

## 12. Invariants

The implementation and tests should preserve these invariants:

1. A device has at most one active incident.
2. `activeIncidentId != null` only while device state is ACTIVE or RECOVERING.
3. WATCHING has no incident ID.
4. NORMAL has no incident ID and no recovery start.
5. A RESOLVED incident is never reopened; a later excursion creates a new incident.
6. Bedrock output never changes monitoring state.
7. Duplicate telemetry never opens a second incident.
8. Older out-of-order telemetry never rewinds current state.

## 13. Edge cases to test

- breach begins then clears before grace expires;
- exact threshold equality (`temp == max`) is treated as non-breach;
- incident opens exactly when grace is satisfied;
- repeated high readings after open;
- recovery begins then rebounds;
- recovery completes;
- duplicate event at transition boundary;
- stale/out-of-order event;
- malformed temperature;
- missing timestamp;
- unknown device.
