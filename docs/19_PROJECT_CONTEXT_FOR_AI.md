# FreshGuard — Compact Project Context for AI Assistants

Use this file as a quick context primer. The detailed docs remain authoritative.

## Mission

Build a top-quality submission for the Sept 17–20, 2026 WeMakeDevs × AWS First Commit hackathon with a two-person team. Target the Ship It track and produce a strong Amazon engineering signal. Reliability and explainable architecture matter more than polish or feature count.

## Product

FreshGuard converts simulated cold-storage MQTT telemetry into auditable operational incidents.

Primary demo:

```text
NORMAL
-> temperature rises
-> WATCHING
-> sustained configured breach
-> one OPEN incident
-> EventBridge
-> SNS alert + Bedrock enrichment
-> temperature recovers
-> RECOVERING
-> same incident RESOLVED
```

## Hard architectural rules

1. No physical hardware is required.
2. Python simulator publishes MQTT/TLS to AWS IoT Core.
3. Detection is deterministic TypeScript domain code.
4. Bedrock never decides if an incident exists.
5. Bedrock is async and noncritical.
6. Repeated high readings update one incident.
7. EventBridge decouples alert and AI enrichment.
8. SNS alert must work without AI.
9. P0 dashboard API is read-only.
10. Use DynamoDB Devices, Telemetry and Incidents tables.
11. Dashboard uses polling, not WebSockets.
12. Infrastructure is AWS SAM.
13. No universal food-safety claims; threshold is configurable demo policy.
14. Do not add AWS services merely for diagram complexity.

## Stack

- Next.js + TypeScript + pnpm
- AWS Amplify Hosting
- Python simulator
- AWS IoT Core
- Lambda (TypeScript, Node 22)
- DynamoDB
- EventBridge
- SNS
- Bedrock
- API Gateway
- CloudWatch
- AWS SAM
- Vitest (+ limited pytest)

## Tables

- Devices: current config/latest/monitoring state/active incident pointer.
- Telemetry: time-ordered recent samples with TTL.
- Incidents: OPEN/RESOLVED records + evidence + notification/AI status; GSI by device/openedAt.

## Monitoring states

- NORMAL
- WATCHING
- ACTIVE
- RECOVERING

Incident states:

- OPEN
- RESOLVED

## Critical invariants

- max one active incident per device;
- WATCHING has no incident;
- duplicate telemetry does not duplicate business actions;
- old telemetry cannot rewind state;
- AI output cannot alter monitoring state;
- an AI failure cannot remove/block incident or alert.

## Scope discipline

P0:

- MQTT simulator;
- ingestion;
- state machine;
- incident lifecycle/idempotency;
- SNS;
- Bedrock explanation;
- read API;
- deployed dashboard;
- logs/tests/IaC.

P1 only after P0:

- stale/offline;
- extra scenarios;
- custom metrics;
- enhanced timeline/UI.

Do not implement in core:

- Cognito;
- physical ESP32;
- spoilage ML;
- autonomous control;
- Device Shadow;
- WebSockets;
- multi-tenant SaaS;
- Step Functions/agents without a new requirement.

## AI coding behavior expected

When asked to implement something:

- read applicable `/docs` first;
- make the smallest change satisfying requirements;
- preserve contracts;
- write tests;
- report manual AWS steps;
- flag conflicts rather than silently changing architecture;
- never introduce secrets;
- never claim completion if relevant checks fail.

## Demo goal

The complete end-to-end flow must succeed at least three consecutive times before recording. The three-minute video must visibly show the deployed product, real state change, one alert, Bedrock explanation, recovery and AWS architecture.
