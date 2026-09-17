# Demo and Submission Strategy

## 1. Constraint

The official submission includes a demo video of up to three minutes, and judges evaluate what is submitted rather than conducting a live demo. Therefore the demo is a product requirement.

## 2. Three-minute target script structure

### 0:00–0:20 — problem

Show FreshGuard dashboard immediately, not a title animation.

Suggested idea:

> Small cold-storage operators can receive sensor readings without having an incident workflow. FreshGuard turns continuous refrigeration telemetry into one auditable incident when a configured excursion persists.

Avoid exaggerated national loss claims unless accurately sourced in the final write-up.

### 0:20–0:40 — healthy state

Show:

```text
Cold Room 01
HEALTHY / NORMAL
4.x°C
Door: CLOSED
Power: ON
```

Mention that the hackathon prototype uses a Python MQTT device simulator rather than physical hardware.

### 0:40–1:15 — trigger excursion

Trigger `door-open-excursion` scenario.

Show temperature rising and state changing:

```text
NORMAL -> WATCHING -> INCIDENT
```

Briefly explain that WATCHING prevents a single noisy reading from immediately becoming an incident.

### 1:15–1:40 — incident/alert

Show:

- one incident ID;
- threshold and grace period;
- opening temperature;
- SNS email/notification;
- peak/latest update.

Say explicitly:

> Repeated high readings update this incident rather than sending one notification per sample.

### 1:40–2:00 — AI explanation

Show Bedrock explanation under the raw evidence.

Say:

> Bedrock does not decide whether an incident exists. Detection is deterministic; AI only explains the verified observations.

### 2:00–2:20 — recovery

Run recovery scenario.

Show:

```text
ACTIVE -> RECOVERING -> NORMAL
```

Incident becomes RESOLVED with duration and peak.

### 2:20–2:45 — AWS architecture

Show architecture image briefly while naming only essential flow:

```text
Python MQTT -> IoT Core -> Lambda -> DynamoDB -> EventBridge -> SNS + Bedrock -> API Gateway -> Amplify
```

Mention CloudWatch and SAM in one sentence.

### 2:45–3:00 — close

Suggested close:

> FreshGuard is deliberately small: one device contract, one incident engine, and one reliable end-to-end workflow. The simulator can later be replaced by an MQTT-capable physical sensor without changing the cloud-facing contract.

## 3. What must visibly appear in the video

- deployed URL/browser;
- working dashboard;
- telemetry changing;
- state transition;
- actual incident record;
- actual external notification;
- actual AI explanation;
- architecture/AWS service usage.

Because AWS use must be shown, include either architecture plus a very short AWS console/CloudWatch proof or equivalent visible evidence. Do not spend most of the video in consoles.

## 4. Recording setup

Use a clean browser profile/windows:

- dashboard large enough to read;
- simulator terminal beside/below only when triggering scenario;
- notification window prepared;
- architecture image pre-opened;
- no credentials/account IDs/private data visible.

Record at readable resolution and test playback before submission.

## 5. Submission write-up outline

### Problem

One paragraph: raw cold-chain telemetry is not the same as an actionable incident workflow.

### Who it is for

Small cold-storage/perishable-goods operators.

### What FreshGuard does

One paragraph describing detection, deduplication, alert, evidence, AI explanation and recovery.

### AWS architecture

Explain why each service is necessary; avoid service-name dumping.

### Engineering choices

Highlight:

- deterministic detection;
- AI off critical path;
- idempotency;
- event-driven decoupling;
- software-defined MQTT device;
- infrastructure as code;
- cost controls.

### What we learned

Be specific about first-time AWS/IoT/event-driven learnings.

### AI coding disclosure

List ChatGPT/Codex accurately as required by rules, plus any other AI tool actually used.

### Limitations

Say plainly:

- simulated sensor;
- demo configuration;
- not a safety certification;
- public read-only prototype dashboard;
- limited single-device demo scope.

## 6. Amazon engineering signal to emphasize in README/write-up

Do not say “we used many AWS services.” Explain engineering reasoning:

- events vs incidents;
- state machine;
- idempotent retries;
- async fan-out;
- degraded mode when Bedrock fails;
- least-privilege roles;
- observable structured logs;
- cost-aware AI invocation.

## 7. Final submission checklist

- [ ] Public repo accessible.
- [ ] Repository created/work history complies with event rules.
- [ ] No secrets in current tree or Git history.
- [ ] License and third-party credits present.
- [ ] README setup works.
- [ ] Deployed URL works in incognito.
- [ ] Three-minute video <= official limit.
- [ ] Video audibly explains who it is for and where AWS fits.
- [ ] AI coding tools disclosed.
- [ ] Architecture image included.
- [ ] Cost decision explained.
- [ ] Limitation of simulated hardware disclosed.
- [ ] Submission entered before deadline.
