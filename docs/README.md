# FreshGuard `/docs`

This directory is the canonical project knowledge base for the FreshGuard AWS First Commit 2026 hackathon project.

## Start here

Read `00_READ_ME_FIRST.md` first.

## Documents

| File | Purpose |
|---|---|
| `00_READ_ME_FIRST.md` | Canonical context, scope and decisions |
| `01_PRD.md` | Product requirements, users, goals, acceptance criteria |
| `02_TDD.md` | Technical design and implementation strategy |
| `03_ARCHITECTURE.md` | Architecture and Mermaid diagrams |
| `04_DOMAIN_AND_STATE_MACHINE.md` | Deterministic detection logic/invariants |
| `05_DATA_MODEL.md` | DynamoDB table/access-pattern design |
| `06_EVENT_AND_API_CONTRACTS.md` | MQTT, EventBridge and HTTP contracts |
| `07_SECURITY_AND_IAM.md` | Security boundaries and permissions |
| `08_RELIABILITY_AND_OBSERVABILITY.md` | Failure behavior, logs, retries |
| `09_TEST_STRATEGY.md` | Unit/integration/E2E plan |
| `10_IMPLEMENTATION_ROADMAP.md` | Four-day execution plan |
| `11_TEAM_WORKFLOW.md` | Two-person ownership and Git workflow |
| `12_AWS_SETUP_RUNBOOK.md` | AWS/local deployment steps |
| `13_DEMO_AND_SUBMISSION.md` | 3-minute demo and submission strategy |
| `14_COST_AND_RESOURCE_GUARDRAILS.md` | Cost-aware design |
| `15_RISK_REGISTER.md` | Risks and mitigations |
| `16_CODEX_WORKFLOW.md` | AI-assisted coding task discipline |
| `17_BACKLOG.md` | P0/P1/P2 implementation checklist |
| `18_ADR_LOG.md` | Architecture decisions and rationale |
| `19_PROJECT_CONTEXT_FOR_AI.md` | Compact context optimized for new AI chats |
| `20_REFERENCES.md` | Official hackathon/AWS sources |

## Importing into a ChatGPT Project

If the project allows all files, import the complete `/docs` directory.

If context/file count is constrained, prioritize:

1. `00_READ_ME_FIRST.md`
2. `01_PRD.md`
3. `02_TDD.md`
4. `04_DOMAIN_AND_STATE_MACHINE.md`
5. `06_EVENT_AND_API_CONTRACTS.md`
6. `10_IMPLEMENTATION_ROADMAP.md`
7. `16_CODEX_WORKFLOW.md`
8. `19_PROJECT_CONTEXT_FOR_AI.md`

## Rule for future edits

When implementation changes a documented contract or architecture decision, update the relevant doc in the same PR/commit. The docs should describe what the project actually is, not what it was originally intended to be.
