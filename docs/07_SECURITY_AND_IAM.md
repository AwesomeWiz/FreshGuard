# Security and IAM

## 1. Security goal

For a four-day public demo, reduce obvious security mistakes while keeping the critical build achievable. Security should be visible in architecture and repository hygiene even though P0 is not a production-certified system.

## 2. Threats considered

- leaked IoT private key;
- overly broad IoT publish permissions;
- frontend obtaining AWS credentials;
- public write/mutation API abuse;
- Lambda roles with `*` permissions;
- prompt injection through arbitrary telemetry strings;
- secrets in logs;
- accidental cost amplification via public endpoints;
- CORS open to every origin unnecessarily.

## 3. IoT device credentials

AWS IoT device authentication uses certificate material provisioned for the simulator.

Local-only directory:

```text
.simulator-certs/
```

Add to `.gitignore`:

```gitignore
.simulator-certs/
*.pem.key
*.pem.crt
.env
.env.*
```

Never paste private keys into ChatGPT, Codex prompts, GitHub issues, screenshots, logs or documentation.

## 4. IoT policy principle

Restrict the simulator to the minimum required operations/topic. Conceptually:

- connect as the expected client ID/prefix;
- publish only to `freshguard/dev/devices/cold-room-01/telemetry`.

Avoid broad `iot:*` permissions.

## 5. Lambda roles

Separate execution roles are preferable when easy through SAM.

### Telemetry Handler

Needs only:

- read/update Devices table;
- put/query required Telemetry records;
- create/update Incidents table;
- `events:PutEvents` on selected event bus;
- CloudWatch Logs through standard execution role.

It does **not** need Bedrock or SNS permission.

### Alert Handler

Needs:

- read/update incident notification fields;
- publish to one SNS topic;
- logs.

### Incident Enricher

Needs:

- read/update incident AI fields;
- invoke the selected Bedrock model;
- logs.

It does **not** need SNS or IoT permission.

### Read API

Needs read-only access to the three DynamoDB tables/indexes required by routes.

## 6. Public API posture

P0 API is intentionally read-only. This is the most important simplification.

Do not expose endpoints that:

- publish telemetry;
- edit thresholds;
- open/resolve incidents;
- invoke Bedrock manually;
- send SNS alerts;
- delete data.

If a public demo URL is crawled or called by someone else, the blast radius is therefore primarily read traffic.

## 7. CORS

Allow:

- the exact Amplify production origin;
- `http://localhost:3000` for local development.

Avoid `*` in final deployment if it is easy to configure correctly.

## 8. Rate/cost protection

For the hackathon:

- enforce API limits in query parameters;
- do not expose Bedrock invocation publicly;
- use short page limits;
- monitor AWS billing/credits;
- optionally configure API Gateway throttling if available in the chosen API type/config.

## 9. Bedrock prompt safety

Telemetry fields are highly structured. Avoid passing arbitrary user-provided prose to the prompt.

The model should see normalized fields and a fixed instruction template. If `deviceId` or other strings are included, validate allowed character sets and lengths first.

## 10. Logging

Never log:

- private key contents;
- full certificate material;
- AWS secret keys;
- authorization headers.

Safe logging fields:

- request ID;
- event ID;
- device ID;
- incident ID;
- state transition;
- outcome/error code;
- duration.

## 11. Frontend secrets

Anything prefixed `NEXT_PUBLIC_` is public. Only the API base URL and non-sensitive demo device ID may be used there.

## 12. Production gaps to acknowledge

P0 deliberately omits:

- user authentication;
- tenant authorization;
- device provisioning UX;
- certificate rotation workflow;
- WAF;
- encryption with custom KMS keys;
- audit/retention compliance controls.

Do not claim production readiness. Instead describe the security boundaries implemented and the production gaps explicitly.
