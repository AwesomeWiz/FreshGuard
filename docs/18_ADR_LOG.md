# Architecture Decision Record (ADR) Log

This file records important decisions so later ChatGPT/Codex sessions do not repeatedly reopen settled questions without evidence.

## ADR-001 — Choose FreshGuard over generic cloud incident-response agent

**Status:** Accepted  
**Reason:** FreshGuard offers a clearer user/impact story and more visually understandable three-minute demo while still demonstrating event-driven AWS engineering. AI incident-response projects are comparatively crowded.  
**Consequence:** Domain is cold-chain telemetry, but architecture should emphasize reusable event/incident principles.

## ADR-002 — No physical hardware in hackathon P0

**Status:** Accepted  
**Decision:** Use a Python MQTT software device simulator.  
**Reason:** Team has no hardware background and hardware adds failure modes without being required to demonstrate cloud architecture.  
**Consequence:** Public materials disclose simulation clearly.

## ADR-003 — Target Ship It

**Status:** Accepted  
**Decision:** Deploy the working project on AWS and provide a URL.  
**Reason:** Strong alignment with project architecture and grand-prize track; cloud architecture/cost becomes part of submission story.

## ADR-004 — Deterministic incident detection

**Status:** Accepted  
**Decision:** Threshold/time state machine opens/resolves incidents. Bedrock cannot decide incident existence.  
**Reason:** Auditability, reliability, cost and defensibility.  
**Consequence:** Domain package has no AWS/LLM dependency.

## ADR-005 — Bedrock is asynchronous enrichment

**Status:** Accepted  
**Decision:** Incident event fans out to Bedrock separately.  
**Reason:** AI failure must not prevent persistence/alert.  
**Consequence:** UI supports GENERATING/READY/FAILED.

## ADR-006 — EventBridge for incident fan-out

**Status:** Accepted  
**Decision:** Telemetry Handler emits domain events; alert and AI consumers are separate.  
**Reason:** Decoupling and clean event-driven architecture.  
**Consequence:** Slightly more infrastructure than direct calls but substantially clearer failure isolation.

## ADR-007 — Polling rather than WebSockets

**Status:** Accepted  
**Decision:** Dashboard polls read API every few seconds.  
**Reason:** Four-day reliability and simplicity outweigh true push realtime.  
**Consequence:** Small latency acceptable for demo.

## ADR-008 — Three DynamoDB tables

**Status:** Accepted  
**Decision:** Devices, Telemetry, Incidents.  
**Reason:** Clarity, easy access patterns, easier debugging/interview explanation.  
**Consequence:** Not optimized into a single-table design.

## ADR-009 — Public read-only demo API, no Cognito P0

**Status:** Accepted  
**Decision:** No public mutation endpoints.  
**Reason:** Auth would consume time without improving core scoring.  
**Consequence:** Must openly describe prototype security limitation.

## ADR-010 — Supporting signals do not determine P0 breach

**Status:** Accepted  
**Decision:** Door/power/humidity provide evidence only; P0 detection uses temperature/time.  
**Reason:** Avoid false causality and keep state machine auditable.  
**Consequence:** Bedrock language must describe them as observations.

## ADR-011 — Demo thresholds are configuration, not standards

**Status:** Accepted  
**Decision:** Use short demo-friendly values and label them clearly.  
**Reason:** Three-minute demo and avoidance of unsupported safety claims.

## ADR-012 — Node.js 22 Lambda + TypeScript

**Status:** Accepted  
**Decision:** Use supported Node.js 22 runtime and TypeScript for Lambda code.  
**Reason:** Team familiarity/monorepo consistency; current AWS support.  
**Consequence:** Revisit only if deployment tooling forces a change.
