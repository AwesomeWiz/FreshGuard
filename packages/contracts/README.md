# FreshGuard Contracts

Demo device:

cold-room-01

MQTT topic:

freshguard/dev/devices/cold-room-01/telemetry

All timestamps use UTC ISO-8601.

Telemetry schema is defined in telemetry.ts.

Import `parseTelemetryPayload` and `TelemetryPayload` (or the existing
`TelemetryReading` type) from `@freshguard/contracts`. Pass a decoded JSON
object to the parser. It returns `{ success: true, data }` or
`{ success: false, error: { field, code, message } }` for the first error.
Errors contain no raw input values. No fields are coerced; unknown fields
are omitted from the validated result.

Required fields: `schemaVersion` (exactly 1), `eventId`, `deviceId`,
`observedAt`, and `temperatureC`.

- Event IDs use 1..128 ASCII letters, digits, `.`, `_`, `:`, or `-`, starting
  with a letter or digit. UUIDs are accepted; uniqueness is an ingestion concern.
- Device IDs use 1..64 ASCII letters, digits, `_`, or `-`, starting with a
  letter or digit. Device registration/allowlisting is a handler concern.
- Timestamps use `YYYY-MM-DDTHH:mm:ss`, optional 1..9 fractional second
  digits, and UTC `Z` or `+00:00`. Invalid calendar dates are rejected.
- Temperature must be finite and within inclusive `-100..200` degrees C.
  This technical bound protects against malformed data, not temperature breaches.

`humidityPct`, `doorState`, and `powerState` remain optional. Omitted or
`undefined` contextual fields stay absent, without defaults. Present values
must be a finite humidity in inclusive `0..100`, an `OPEN | CLOSED | UNKNOWN`
door state, or an `ON | OFF | UNKNOWN` power state. `null` is invalid.

Checks:

```sh
pnpm --filter @freshguard/contracts test
pnpm --filter @freshguard/contracts typecheck
```
