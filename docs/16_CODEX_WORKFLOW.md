# Codex / AI-Assisted Development Workflow

## 1. Objective

Use Codex to accelerate implementation while preserving team understanding and a clean, reviewable codebase. AI coding tools are allowed by the hackathon but must be disclosed in the write-up.

## 2. Source-of-truth order for Codex

For every substantial task, instruct Codex to read relevant docs before coding:

1. `docs/00_READ_ME_FIRST.md`
2. `docs/01_PRD.md`
3. `docs/02_TDD.md`
4. the task-specific document
5. existing implementation/tests

Codex must not silently redesign architecture because it finds another pattern more sophisticated.

## 3. Task size

Give one bounded engineering task at a time.

Good:

> Implement the pure monitoring state machine described in `docs/04_DOMAIN_AND_STATE_MACHINE.md`, with Vitest cases for every transition/invariant. Do not add AWS SDK calls to the domain package.

Bad:

> Build the whole FreshGuard app.

## 4. Required prompt template

```text
You are implementing FreshGuard during a 4-day AWS hackathon.

Read first:
- docs/00_READ_ME_FIRST.md
- docs/01_PRD.md
- docs/02_TDD.md
- <task-specific docs>

Task:
<single scoped task>

Constraints:
- Preserve documented architecture and contracts.
- Do not add unrelated services/dependencies/features.
- Do not expose secrets.
- Keep Bedrock out of deterministic detection logic.
- Write/update tests for behavior changed.
- Prefer the smallest production-shaped implementation that satisfies the task.
- If docs and code conflict, report the conflict rather than silently choosing.
- Do not mark the task complete unless lint/typecheck/tests relevant to the change pass.

Return:
1. files changed,
2. implementation summary,
3. tests run/results,
4. assumptions/trade-offs,
5. any manual AWS step still required.
```

## 5. Recommended task sequence

### TASK-001 Foundation

- workspace;
- Next.js app;
- TS config/lint/test;
- SAM skeleton;
- Python simulator package;
- CI skeleton.

### TASK-002 Domain engine

- types;
- state evaluator;
- invariant tests.

### TASK-003 Telemetry contracts + simulator

- schema;
- Python MQTT publisher;
- deterministic scenarios.

### TASK-004 AWS IoT ingestion

- IoT Rule;
- Telemetry Handler;
- device/telemetry persistence;
- IAM.

### TASK-005 Incident lifecycle

- DynamoDB incident record;
- idempotent open/update/resolve;
- EventBridge events.

### TASK-006 Alerting

- Alert Handler;
- SNS;
- notification state/idempotency.

### TASK-007 Read API

- API Gateway;
- read Lambda;
- DTOs/validation.

### TASK-008 Dashboard

- current status;
- chart;
- active/history;
- polling/error states.

### TASK-009 Bedrock enrichment

- evidence prompt;
- async handler;
- failure state.

### TASK-010 Hardening/submission

- structured logs;
- TTL/log retention;
- README;
- secret scan;
- E2E checklist.

## 6. Review every AI-generated infrastructure change

Humans must understand before deployment:

- IAM permissions;
- IoT policies;
- public endpoints;
- DynamoDB keys/indexes;
- EventBridge patterns;
- Bedrock model permissions;
- deletion/retention policies.

Never deploy a generated `Action: "*"`, `Resource: "*"` policy without understanding why it is necessary; narrow it whenever practical.

## 7. Prevent “AI architecture drift”

Reject suggestions to add the following unless the documented requirement changed:

- Cognito;
- AppSync;
- Kinesis;
- SQS everywhere;
- Step Functions;
- OpenSearch;
- agentic framework;
- physical sensor stack;
- microservices beyond the defined Lambdas.

More AWS logos do not equal a better score.

## 8. Commit discipline

After a coherent passing task:

```text
feat(domain): add deterministic incident state machine
feat(iot): ingest telemetry through IoT Core
feat(alerts): send incident-open SNS notification
fix(incidents): prevent duplicate open incident
```

Avoid giant “AI generated project” commits.

## 9. AI disclosure language for final write-up

Use a truthful statement such as:

> We used ChatGPT/Codex as an AI coding assistant for implementation scaffolding, debugging, tests and documentation. The team designed and reviewed the architecture, AWS configuration, domain state machine, security boundaries, cost decisions and demo, and validated all submitted behavior.

Adjust to what was actually done.
