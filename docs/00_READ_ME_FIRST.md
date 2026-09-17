# FreshGuard — Read Me First

## Purpose of this documentation

This `/docs` directory is the canonical project context for **FreshGuard**, a four-day AWS First Commit 2026 hackathon project. It is designed to be useful to:

- the two-person implementation team;
- a new ChatGPT Project used as a project copilot;
- Codex when given scoped implementation tasks;
- reviewers reading the public repository;
- judges or Amazon engineers who inspect the architecture after the demo.

If another document conflicts with this file, treat this file plus `01_PRD.md`, `02_TDD.md`, and `03_ARCHITECTURE.md` as the source of truth and update the conflicting document.

## Project in one sentence

**FreshGuard is an event-driven cold-chain incident intelligence system that ingests simulated refrigeration telemetry through AWS IoT Core, deterministically detects sustained temperature excursions, creates auditable incidents, alerts an operator, and uses Amazon Bedrock only to explain verified evidence.**

## Hackathon context

Event: **WeMakeDevs × AWS First Commit, Bharat Builds Tour**  
Dates: **September 17–20, 2026**  
Team size: **2**  
Target track: **Ship It**  
Primary objective: build a reliable, deployed, AWS-native project with a strong three-minute demo and strong engineering signal for the separate Amazon fast-track opportunity.

Important rule constraints:

- The project must be new and built during the event window.
- Open-source frameworks, libraries, public APIs, boilerplate, starter templates, and AI coding tools are allowed, but AI tools used must be disclosed.
- AWS usage must be real and visible in the demo.
- Submission requires a public repository, a demo video up to three minutes, and a short write-up.
- Judges score only submitted material; there is no live judging call.
- The event explicitly values: Idea and Impact, Built on AWS, Learning, Execution, and Demo Video.
- Ship It requires a deployed AWS project/URL and architecture/cost decisions matter.
- Amazon fast-track selection is separate from prizes and is not guaranteed.

Official sources are collected in `20_REFERENCES.md`.

## Canonical product scope

### P0 — must work perfectly

1. A software device simulator publishes JSON telemetry over MQTT to AWS IoT Core.
2. AWS IoT Core routes telemetry to a Lambda handler.
3. The handler validates and persists telemetry.
4. A deterministic state machine detects a sustained high-temperature excursion.
5. Exactly one incident is opened for a continuous excursion.
6. Opening an incident emits an EventBridge domain event.
7. An SNS alert is sent independently of AI enrichment.
8. Bedrock receives structured, verified incident evidence and generates a short explanation.
9. The deployed dashboard shows current status, recent telemetry, active/recent incidents, and AI explanation.
10. When readings recover for a configured period, the incident is resolved and its duration/peak are retained.
11. CloudWatch contains meaningful structured logs for the critical path.
12. Infrastructure is reproducible with AWS SAM.

### P1 — add only after P0 is stable

- Device offline/stale-data indication based on `lastSeenAt`.
- Door-open and power-state scenario simulation.
- Recovery explanation from Bedrock.
- Incident timeline.
- Better charts and responsive UI.
- CloudWatch custom metrics/alarms.

### P2 — explicitly optional

- AWS IoT Device Shadow.
- Authentication/Cognito.
- Multiple organizations/sites.
- Predictive maintenance or spoilage prediction.
- Physical ESP32/sensor hardware.
- Automated remediation/control of refrigeration equipment.

## Core engineering principles

### 1. Deterministic detection; probabilistic explanation

Bedrock must never decide whether a breach exists. Threshold, grace-period, recovery and deduplication decisions are ordinary deterministic code.

Bedrock is an enrichment dependency. If Bedrock fails:

- the incident still opens;
- the incident is persisted;
- the alert still sends;
- the dashboard remains usable.

### 2. Events are not incidents

A violating telemetry reading is an event. A sustained excursion is an incident. Repeated violating readings must update one active incident, not create multiple incidents or notifications.

### 3. Do not make unsupported safety claims

The system detects **configured temperature excursions**. It does not diagnose food safety, guarantee product quality, predict spoilage, or claim a universal safe threshold.

Demo thresholds are test configuration only.

### 4. No hardware dependency

The prototype uses a Python MQTT simulator. It represents the same cloud-facing contract a physical sensor could use later. Hardware is not required for the hackathon and must not become part of the critical path.

### 5. Reliability over breadth

If a feature threatens the core demo, remove the feature. One end-to-end path that works repeatedly is the primary goal.

## Canonical technology stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + TypeScript |
| Hosting | AWS Amplify Hosting |
| Device simulation | Python 3.12+ |
| Protocol | MQTT over TLS |
| Device ingress | AWS IoT Core |
| Compute | AWS Lambda, TypeScript, Node.js 22 |
| Event routing | Amazon EventBridge |
| Database | Amazon DynamoDB |
| Alerting | Amazon SNS |
| Generative AI | Amazon Bedrock |
| HTTP API | Amazon API Gateway + Lambda |
| Observability | Amazon CloudWatch |
| IaC | AWS SAM / CloudFormation |
| Tests | Vitest for TypeScript/domain; pytest for simulator where useful |
| Package manager | pnpm |
| CI | GitHub Actions |

## Canonical repository layout

```text
freshguard/
├─ apps/
│  └─ web/                     # Next.js dashboard
├─ simulator/
│  ├─ freshguard_simulator/    # Python MQTT simulator
│  └─ scenarios/               # deterministic demo scenarios
├─ services/
│  ├─ telemetry-handler/       # IoT -> validation/state machine/persistence
│  ├─ incident-enricher/       # EventBridge -> Bedrock -> incident update
│  ├─ alert-handler/           # EventBridge -> SNS
│  └─ api/                     # API Gateway read endpoints
├─ packages/
│  ├─ domain/                  # pure state machine + domain types
│  └─ contracts/               # event/payload schemas
├─ infrastructure/
│  └─ template.yaml            # AWS SAM
├─ tests/
│  └─ integration/
├─ docs/
├─ .github/workflows/ci.yml
├─ README.md
├─ LICENSE
├─ package.json
└─ pnpm-workspace.yaml
```

## Recommended document reading order for a new ChatGPT Project

1. `00_READ_ME_FIRST.md`
2. `01_PRD.md`
3. `02_TDD.md`
4. `03_ARCHITECTURE.md`
5. `04_DOMAIN_AND_STATE_MACHINE.md`
6. `05_DATA_MODEL.md`
7. `06_EVENT_AND_API_CONTRACTS.md`
8. `07_SECURITY_AND_IAM.md`
9. `08_RELIABILITY_AND_OBSERVABILITY.md`
10. `09_TEST_STRATEGY.md`
11. `10_IMPLEMENTATION_ROADMAP.md`
12. `11_TEAM_WORKFLOW.md`
13. `12_AWS_SETUP_RUNBOOK.md`
14. `13_DEMO_AND_SUBMISSION.md`
15. `14_COST_AND_RESOURCE_GUARDRAILS.md`
16. `15_RISK_REGISTER.md`
17. `16_CODEX_WORKFLOW.md`
18. `17_BACKLOG.md`
19. `18_ADR_LOG.md`
20. `19_PROJECT_CONTEXT_FOR_AI.md`
21. `20_REFERENCES.md`

## Definition of hackathon success

FreshGuard is successful if a teammate can run one command to start the simulator, select a failure scenario, and the deployed dashboard reliably demonstrates:

```text
HEALTHY
  -> WATCHING
  -> INCIDENT OPEN
  -> SNS ALERT
  -> BEDROCK EXPLANATION
  -> RECOVERING
  -> RESOLVED
```

with the incident record remaining auditable even if AI enrichment is unavailable.
