# Product Requirements Document (PRD)

## 1. Product name

**FreshGuard — Event-Driven Cold-Chain Incident Intelligence on AWS**

## 2. Problem statement

Small operators who store or move perishable products may not notice a refrigeration temperature excursion quickly enough. Basic sensors can produce readings, but raw telemetry alone does not provide an operational incident workflow: operators need to know when an excursion has persisted long enough to matter under their configured policy, whether it is still active, what evidence accompanied it, and when it recovered.

FreshGuard focuses on one narrow problem:

> Convert a continuous stream of cold-storage telemetry into a small number of understandable, auditable operational incidents.

The hackathon prototype does not attempt to establish food-safety standards. Thresholds and timing rules are configurable values supplied by an operator/demo configuration.

## 3. Product hypothesis

If operators receive a single, timely incident for a sustained configured temperature excursion—rather than raw readings or repeated alerts—they can identify abnormal refrigeration conditions faster and understand the observed evidence without having to interpret telemetry manually.

## 4. Target user

### Primary persona: small cold-storage operator

Examples include a small retailer, cloud kitchen, dairy collection point, seafood distributor, produce storage room, or similar operator with one or more refrigeration units.

Needs:

- see whether a monitored unit is currently healthy;
- know when a configured limit has been exceeded long enough to open an incident;
- avoid alert spam;
- see supporting observations such as door and power state;
- see when the condition recovered;
- retain a small incident history.

### Secondary persona: operations/maintenance technician

Needs:

- incident timestamps;
- peak recorded temperature;
- recent telemetry;
- observed device signals;
- an evidence-grounded summary;
- confidence that AI did not fabricate the underlying incident.

## 5. Jobs to be done

1. **When a cold-storage unit starts behaving abnormally, tell me when the configured excursion becomes an incident.**
2. **When an incident opens, notify me once rather than for every bad reading.**
3. **When I inspect an incident, show me the evidence that produced it.**
4. **When conditions recover, record the recovery automatically.**
5. **When AI is used, keep the original evidence visible and the decision deterministic.**

## 6. Goals

### G1 — reliable incident detection

Convert telemetry into state transitions based on configured thresholds and durations.

### G2 — alert deduplication

One continuous excursion should map to one incident and normally one opening notification.

### G3 — auditable evidence

Every incident must contain or reference enough deterministic data to explain why it exists.

### G4 — useful AI enrichment

Bedrock should translate verified evidence into a concise human-readable explanation without being responsible for the detection decision.

### G5 — visible AWS-native architecture

The submission must demonstrate a real AWS event pipeline rather than merely hosting a frontend on AWS.

### G6 — hackathon reliability

The complete core flow must be repeatable during recording without manual database repair or console intervention.

## 7. Non-goals

FreshGuard v0 is **not**:

- a certified food safety system;
- a spoilage prediction model;
- a HACCP compliance product;
- a refrigeration controller;
- a fleet-scale industrial IoT platform;
- a multi-tenant SaaS platform;
- a hardware product;
- a replacement for calibrated physical sensing equipment;
- an autonomous AI agent that changes equipment settings.

## 8. Product principles

1. **Evidence first.** Always show concrete readings and timestamps before generated prose.
2. **AI off the critical path.** Alerts and incident persistence cannot depend on Bedrock.
3. **No alert storms.** Incident semantics are more important than raw threshold triggers.
4. **Clear current state.** A user should understand the unit state within two seconds of opening the dashboard.
5. **Small surface area.** No unnecessary settings, onboarding, auth, or CRUD screens in P0.

## 9. Core user experience

### Dashboard

The first screen shows:

- unit name/device ID;
- large state badge: Healthy / Watching / Incident / Recovering / Stale;
- current temperature;
- configured maximum temperature;
- current door state;
- current power state;
- last-seen timestamp;
- recent telemetry chart;
- active incident if present;
- recent incident history.

### Incident card/page

An incident contains:

- incident ID;
- device ID;
- status: OPEN or RESOLVED;
- started timestamp;
- resolved timestamp when applicable;
- configured threshold;
- grace period;
- peak temperature;
- current/latest temperature while active;
- door/power observations at opening;
- notification state;
- Bedrock explanation status and text;
- explicit label that the explanation is AI-generated from observed evidence.

## 10. Functional requirements

### FR-1 Telemetry ingestion — P0

The simulator shall publish JSON messages to an AWS IoT Core MQTT topic.

Acceptance criteria:

- valid telemetry reaches the telemetry Lambda;
- invalid payloads are rejected/logged safely;
- every message includes a unique event ID and UTC timestamp;
- no private key/certificate is committed to Git.

### FR-2 Telemetry persistence — P0

Valid telemetry shall be stored in DynamoDB with a short retention period suitable for the hackathon.

Acceptance criteria:

- dashboard can retrieve recent samples by device and time;
- duplicate `eventId` does not create duplicate telemetry records;
- TTL can remove old telemetry later.

### FR-3 Device state — P0

The system shall maintain the latest known device telemetry and monitoring state.

States:

- NORMAL
- WATCHING
- ACTIVE
- RECOVERING

Optional presentation state:

- STALE when no recent telemetry has been received.

### FR-4 Sustained breach detection — P0

A temperature above the configured maximum shall not immediately create an incident. It starts or continues a WATCHING period. An incident opens only after the configured grace duration is satisfied.

Demo defaults may be deliberately short (for example 8°C maximum and 15–30 second grace) and must be labeled **demo configuration**, not universal safety guidance.

### FR-5 Incident deduplication — P0

A continuous excursion must create a single active incident. Additional high readings update that incident rather than opening another.

### FR-6 Recovery — P0

When readings return at or below the configured threshold, the state moves to RECOVERING. The incident resolves only after the configured recovery duration is satisfied. A rebound above threshold before recovery completion returns the state to ACTIVE.

### FR-7 Domain events — P0

Incident opening and resolution shall emit domain events to EventBridge.

Required events:

- `freshguard.incident.opened`
- `freshguard.incident.resolved`

### FR-8 Notification — P0

An opening event shall trigger an SNS notification.

Acceptance criteria:

- one opening notification per incident under normal operation;
- message includes device, time, observed temperature and threshold;
- notification does not depend on Bedrock.

### FR-9 AI explanation — P0

Opening an incident shall asynchronously request an explanation from Amazon Bedrock.

Requirements:

- input is structured evidence only;
- model is told not to invent causes;
- door/power states are described as observations or associations, not proven causality;
- generated output is short enough for the dashboard;
- AI failure sets a visible enrichment status and does not break the incident.

### FR-10 Dashboard — P0

A public read-only deployed dashboard shall show the end-to-end system state.

Required views:

- current unit status;
- recent telemetry chart;
- active incident;
- recent incidents.

### FR-11 Observability — P0

Critical Lambda functions shall use structured JSON logging including correlation fields such as `eventId`, `deviceId`, `incidentId`, and operation/result.

### FR-12 Simulator scenarios — P0

The simulator shall support deterministic scenarios:

- normal;
- door left open / rising temperature;
- recovery.

P1:

- power failure;
- disconnect/stale telemetry.

## 11. Non-functional requirements

### NFR-1 Reliability

The core workflow should tolerate duplicate telemetry events and Bedrock failure without opening duplicate incidents or losing the alert.

### NFR-2 Security

- simulator certificate/private key remains local and ignored by Git;
- IAM roles use least privilege appropriate to the hackathon;
- dashboard exposes read-only APIs only;
- secrets are not embedded in frontend code;
- logs avoid credentials/secrets.

### NFR-3 Performance

For hackathon/demo volume, the dashboard should normally reflect telemetry within several seconds. This is a demo target rather than an SLA.

### NFR-4 Cost

- use on-demand/serverless services;
- Bedrock is invoked per incident, not per reading;
- short log retention;
- short telemetry TTL;
- avoid always-on compute.

### NFR-5 Reproducibility

A clean AWS environment should be deployable primarily from `infrastructure/template.yaml` and documented commands.

### NFR-6 Explainability

An incident must remain understandable without reading the AI summary.

## 12. Success metrics for the hackathon

These are engineering/demo metrics, not claims about real-world food outcomes.

- 100% of the planned demo runs complete the P0 flow without manual repair.
- one continuous simulated breach creates exactly one incident.
- one incident opening produces no more than one normal opening alert.
- incident remains visible if Bedrock call is deliberately failed.
- recovery closes the same incident rather than creating another.
- recent telemetry and incident history can be loaded from the deployed dashboard.
- a new teammate can understand the project from `/docs` and run the setup instructions.

## 13. Demo narrative

The primary demo story is intentionally simple:

1. Cold Room 01 is healthy.
2. The simulator changes to a door-open/rising-temperature scenario.
3. The dashboard enters WATCHING while temperature is above the configured limit.
4. After the grace period, FreshGuard opens one incident.
5. SNS sends an alert.
6. Bedrock produces a grounded explanation from the captured evidence.
7. The simulator begins a recovery scenario.
8. The dashboard enters RECOVERING.
9. After stable recovery, the same incident is marked RESOLVED and shows duration and peak temperature.

## 14. Explicit product claims allowed in public materials

Safe claims:

- detects configured sustained temperature excursions;
- turns telemetry into incidents;
- avoids one-alert-per-reading behavior;
- stores incident evidence and history;
- uses AI to explain observed evidence;
- uses simulated MQTT telemetry in the hackathon prototype;
- can later connect to a physical MQTT-capable device without changing the cloud-facing telemetry contract.

Avoid claims such as:

- prevents food poisoning;
- certifies food safety;
- predicts exact spoilage;
- identifies the true root cause with certainty;
- guarantees savings;
- uses a medically or legally mandated universal threshold.
