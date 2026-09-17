# Backlog

## P0 — Submission blockers

### Foundation

- [ ] New hackathon-compliant repository initialized.
- [ ] pnpm workspace configured.
- [ ] Next.js app builds.
- [ ] TypeScript Lambda build setup.
- [ ] SAM stack deploys.
- [ ] Python simulator environment works.

### Domain

- [ ] Telemetry schema/types.
- [ ] Monitoring states.
- [ ] Pure state evaluator.
- [ ] Required transition tests.
- [ ] Out-of-order guard.

### AWS ingestion

- [ ] IoT Thing/certificate/policy.
- [ ] MQTT simulator connects.
- [ ] IoT rule invokes Lambda.
- [ ] Telemetry DynamoDB writes.
- [ ] Devices latest state updates.

### Incident engine

- [ ] OPEN incident creation.
- [ ] active incident update.
- [ ] peak temperature update.
- [ ] recovery state.
- [ ] incident resolution.
- [ ] duplicate prevention.
- [ ] EventBridge open/resolved events.

### Alerts

- [ ] SNS topic.
- [ ] subscription confirmed.
- [ ] opening event sends one alert.
- [ ] notification result tracked.

### API

- [ ] `/health`.
- [ ] device current state.
- [ ] recent telemetry.
- [ ] recent incidents.
- [ ] incident detail.
- [ ] bounded query limits.
- [ ] CORS.

### UI

- [ ] deployed Amplify URL.
- [ ] large current-state badge.
- [ ] current telemetry values.
- [ ] chart.
- [ ] active incident card.
- [ ] history.
- [ ] error/empty states.

### Bedrock

- [ ] model access confirmed.
- [ ] async EventBridge consumer.
- [ ] grounded prompt.
- [ ] AI READY/FAILED state.
- [ ] AI failure leaves alert/incident unaffected.

### Submission quality

- [ ] structured logs.
- [ ] least-privilege review.
- [ ] TTL/log retention.
- [ ] architecture diagram.
- [ ] README.
- [ ] AI disclosure.
- [ ] license/third-party credits.
- [ ] secret scan.
- [ ] three consecutive E2E runs.
- [ ] <=3 minute demo.

## P1 — Only after P0 green

- [ ] stale/offline display.
- [ ] power failure simulator scenario.
- [ ] recovery Bedrock explanation.
- [ ] incident timeline.
- [ ] custom CloudWatch metrics.
- [ ] nicer mobile layout.
- [ ] better simulator CLI menu.

## P2 — Do not start during core build

- [ ] Device Shadow.
- [ ] Cognito.
- [ ] multi-site/tenant model.
- [ ] physical ESP32.
- [ ] predictive model.
- [ ] automated equipment control.
- [ ] WebSockets/AppSync.
- [ ] long-term analytics.
