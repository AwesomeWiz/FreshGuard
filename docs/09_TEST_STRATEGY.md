# Test Strategy

## 1. Test philosophy

In four days, test the logic that can lose the demo: state transitions, idempotency, payload validation, API mapping and end-to-end event flow. Do not chase meaningless coverage percentage.

## 2. Test pyramid

### Level 1 — pure domain unit tests (highest priority)

Target `packages/domain` with Vitest.

Required cases:

1. NORMAL + normal reading -> NORMAL.
2. NORMAL + high reading -> WATCHING with breach start.
3. WATCHING clears before grace -> NORMAL, no incident.
4. WATCHING high but grace incomplete -> WATCHING.
5. WATCHING high when grace satisfied -> ACTIVE + OPEN_INCIDENT.
6. ACTIVE high -> ACTIVE + incident update.
7. ACTIVE normal -> RECOVERING.
8. RECOVERING normal before grace -> RECOVERING.
9. RECOVERING high -> ACTIVE, same incident.
10. RECOVERING completes -> NORMAL + RESOLVE_INCIDENT.
11. equality to max is non-breach according to canonical rule.
12. old observation -> no state change.

### Level 2 — contract/validation tests

- valid telemetry accepted;
- missing required fields rejected;
- NaN/non-number temperature rejected;
- invalid enum rejected;
- overly long device ID rejected;
- unsupported schema version rejected.

### Level 3 — handler tests with mocked AWS clients

Telemetry Handler:

- duplicate telemetry conditional failure becomes no-op;
- incident open writes expected record/event;
- active incident does not duplicate;
- Bedrock is never called from telemetry handler.

Alert Handler:

- publishes expected message;
- does not intentionally resend after SENT marker.

Enricher:

- prompt contains only normalized evidence;
- Bedrock success saves text/status;
- Bedrock exception saves/records FAILED where possible.

API:

- device mapping;
- recent telemetry bounds;
- incident not found;
- internal exception does not leak stack.

## 3. Simulator tests

Use pytest only where useful:

- scenario emits valid schema;
- timestamps increase;
- event IDs are unique;
- scenario transitions produce expected numeric sequence.

## 4. Integration tests

### Integration A — deployed MQTT ingestion

Publish one known event and verify it reaches Telemetry/Devices tables.

### Integration B — incident open

Run a shortened breach sequence and verify:

- one incident OPEN;
- device ACTIVE;
- EventBridge consumer ran;
- SNS received;
- Bedrock status READY or explicit FAILED.

### Integration C — recovery

Run recovery and verify same incident becomes RESOLVED.

### Integration D — duplicate

Republish the same exact event ID and confirm no duplicate incident/alert.

## 5. End-to-end acceptance scenario

The release candidate passes only after this sequence succeeds three consecutive times:

```text
reset NORMAL
-> publish normal baseline
-> start breach scenario
-> WATCHING
-> ACTIVE/open incident
-> alert received
-> AI explanation visible
-> recovery scenario
-> RECOVERING
-> RESOLVED
```

## 6. Manual failure injection

At least once before submission:

- temporarily configure invalid Bedrock model ID or mock failure;
- open incident;
- confirm incident + alert still work;
- restore configuration.

This proves the architecture decision rather than merely claiming it.

## 7. CI checks

GitHub Actions on push/PR should run, as time allows:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Python simulator:

```text
python -m pytest
```

Do not spend hours perfecting CI if local/deployed P0 is still incomplete.

## 8. Definition of done per task

A task touching business behavior is not done until:

- implementation exists;
- relevant tests exist/update;
- docs/contracts are not contradicted;
- lint/typecheck pass;
- deployed behavior is verified when the change is infrastructure-related.
