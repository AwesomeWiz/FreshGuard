# Two-Person Team Workflow

## 1. Objective

Parallelize without creating two incompatible systems.

## 2. Suggested ownership

### Person A — cloud/backend owner

Primary responsibility:

- AWS SAM;
- IoT Core;
- Lambda handlers;
- DynamoDB;
- EventBridge;
- SNS;
- Bedrock;
- IAM;
- CloudWatch;
- backend deployment.

### Person B — product/client owner

Primary responsibility:

- Next.js dashboard;
- API client/types;
- chart/UI states;
- Python simulator;
- demo scenario controls;
- Amplify deployment;
- demo recording/editing support.

### Shared responsibility

- domain state machine semantics;
- API/event contracts;
- tests;
- README;
- demo narrative;
- architecture explanation.

Both teammates must understand the entire system before submission.

## 3. Git workflow

Recommended:

- `main` must remain deployable;
- short-lived branches: `feat/...`, `fix/...`;
- PR/review each other's high-risk changes where time permits;
- merge frequently rather than accumulating a huge integration at night.

Suggested branch examples:

```text
feat/iot-ingestion
feat/incident-state-machine
feat/dashboard
feat/simulator
feat/bedrock-enrichment
fix/incident-idempotency
```

## 4. Contract-first coordination

Before Person A and B work independently, agree on:

- telemetry JSON;
- device API response;
- incident API response;
- state names;
- polling behavior.

Those contracts live in `06_EVENT_AND_API_CONTRACTS.md` and shared TypeScript types where applicable.

## 5. Check-ins

Use very short check-ins every few hours:

```text
DONE:
BLOCKED:
NEXT:
CONTRACT CHANGES:
```

Any contract change must be communicated immediately.

## 6. Merge discipline

Before merging:

- no secrets;
- tests/lint/typecheck for touched code;
- no unrelated refactors;
- update docs if behavior changed;
- smoke test critical path if infrastructure changed.

## 7. Who records the demo

One teammate should narrate and control the dashboard. The other should:

- trigger simulator scenarios;
- watch SNS/CloudWatch;
- ensure no stale previous incident pollutes the recording;
- note timestamps for retakes.

## 8. Knowledge-sharing requirement

By Day 3, Person B must be able to explain why EventBridge/Bedrock are decoupled, and Person A must be able to explain the dashboard user flow. This matters for recruiter/interview conversations even if there is no live judging call.
