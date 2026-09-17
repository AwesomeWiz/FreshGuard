# Four-Day Implementation Roadmap

## 1. Principle

The project must be demonstrable well before the submission deadline. Day 4 is a release/demo day, not a feature day.

## Day 1 — Thursday, Sept 17: make one event cross AWS

### Goal

A real MQTT message from the laptop must reach AWS and update persistent device state.

### Workstream A — backend/AWS

1. Create new public/private development repository only after event start according to rules.
2. Initialize pnpm workspace and SAM infrastructure.
3. Create AWS IoT Thing/certificate/policy for simulator.
4. Verify publishing/subscribing with AWS IoT test client or simulator.
5. Create Devices + Telemetry + Incidents tables.
6. Deploy Telemetry Handler Lambda.
7. Create IoT Topic Rule -> Lambda.
8. Implement schema validation.
9. Persist telemetry.
10. Implement pure state-machine package + unit tests.
11. Update Devices state from telemetry.

### Workstream B — frontend/simulator

1. Initialize Next.js dashboard.
2. Implement Python simulator connection/config.
3. Implement baseline + breach + recovery scenario data.
4. Build static dashboard shell using mock API data.

### Day-1 exit criteria

- simulator publishes from laptop;
- AWS IoT Core receives it;
- Lambda logs it;
- DynamoDB contains it;
- domain tests for state transitions pass.

If this is not true, do not start Bedrock/UI polish.

## Day 2 — Friday, Sept 18: complete the business loop

### Goal

A breach creates one incident and a recovery resolves it; deployed dashboard reads the result.

### Backend

1. Implement WATCHING/ACTIVE/RECOVERING transitions.
2. Implement incident opening/update/resolution.
3. Add deduplication and stale-event checks.
4. Add EventBridge incident events.
5. Add Alert Handler + SNS.
6. Implement read API routes.
7. Deploy backend.

### Frontend

1. Connect API.
2. Add state badge/current readings.
3. Add telemetry chart.
4. Add active incident card.
5. Add incident history.
6. Deploy to Amplify.

### Day-2 exit criteria

A judge-worthy flow works without Bedrock:

```text
simulator -> IoT -> incident -> SNS -> dashboard -> recovery
```

This is the minimum viable submission.

## Day 3 — Saturday, Sept 19: AI, reliability and engineering quality

### Goal

Turn the working prototype into a strong AWS engineering submission.

1. Add Incident Enricher -> Bedrock.
2. Harden prompt/evidence contract.
3. Add AI loading/failed states.
4. Add structured logging.
5. Tighten IAM policies.
6. Set telemetry TTL and log retention.
7. Add CloudWatch operational view/metrics if time.
8. Run duplicate/out-of-order tests.
9. Improve responsive dashboard and visual hierarchy.
10. Write README architecture section.
11. Ensure SAM deployment is reproducible.
12. Run a deliberate Bedrock failure test.

Optional only after stable:

- stale/offline indicator;
- power-failure simulator scenario;
- incident timeline.

## Day 4 — Sunday, Sept 20: freeze, prove, submit

### No major new architecture

1. Freeze feature scope.
2. Fix only bugs that affect scoring/demo/reproducibility.
3. Run full E2E scenario at least three times.
4. Clean repository and verify no secrets.
5. Verify commit history reflects event dates.
6. Finalize architecture image/README.
7. Finalize Builder Center write-up if pursuing blog recognition.
8. Record demo multiple times and pick the clearest one.
9. Submit early; update submission if allowed before deadline.
10. Keep deployed URL healthy through judging period as practical.

## 2. Priority ladder

If schedule slips, cut from the bottom upward:

### Never cut

- IoT ingress;
- deterministic state machine;
- incident lifecycle;
- DynamoDB;
- SNS alert;
- deployed dashboard;
- visible AWS usage;
- tests for state machine.

### Cut second

- elaborate CloudWatch metrics;
- extra simulator scenarios;
- offline/stale device logic;
- recovery AI explanation;
- animations.

### Cut first

- authentication;
- admin settings;
- multi-user support;
- physical hardware;
- predictive ML;
- Device Shadow;
- WebSockets;
- mobile app;
- Step Functions;
- agent framework.

## 3. Milestone labels

Use these GitHub milestones/issues if useful:

- M1: Ingestion Alive
- M2: Incident Engine
- M3: Deployed Product
- M4: AI + Reliability
- M5: Submission Ready
