# Telemetry Handler — Day-1 foundation

Consumes decoded IoT telemetry using `@freshguard/contracts` validation and
`@freshguard/domain` evaluation. Tests inject a document client, clock and logger;
no AWS account or credentials are needed for unit tests.

Processing order: validate, conditionally persist telemetry, consistently read
the configured device, evaluate, conditionally update state. A duplicate telemetry
write skips storage only; device processing continues. If `latest.eventId` matches
the incoming event, return `duplicate` before evaluation or a second device update.
Otherwise resume processing, subject to the existing stale check and version
condition. Check `latest.eventId` on every fresh read, including conflict retries.
Storage-only duplicates log `telemetry_duplicate` with `result: storage_duplicate`;
fully processed duplicates log `result: duplicate`.
Unknown devices remain in telemetry history and return
`device_not_found`; the handler never creates device configuration. Seed records
follow `docs/12_AWS_SETUP_RUNBOOK.md`: top-level thresholds/timing, monitoring
state and numeric `version`. Missing empty state timestamps map to `null`.
Missing/invalid configuration fails explicitly without default thresholds.

Older observations are retained in history but cannot change current state.
Dates are compared by the existing domain evaluator, not lexicographically.
Updates require the version read from DynamoDB and increment it atomically.
Conditional conflicts trigger a fresh consistent read and reevaluation, up to
three update attempts. No unconditional fallback exists. `latest` replaces the
previous observation, preserving absent optional contextual fields. `lastSeenAt`
uses receipt time; `lastProcessedAt` uses observation time. TTL is seven days
from receipt. Domain actions are logged only; incident persistence is deferred.

## Build and SAM packaging

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @freshguard/telemetry-handler test
pnpm --filter @freshguard/telemetry-handler typecheck
pnpm --filter @freshguard/telemetry-handler build
sam validate --template-file infrastructure/template.yaml
sam build --template-file infrastructure/template.yaml
```

The build bundles both workspace packages and AWS SDK v3 into `dist/index.js`
for Node.js 22, with a CommonJS package marker. No runtime dependencies need to
be installed in the deployment directory. Always rebuild before SAM packaging.
SAM references `dist/` with `SkipBuild: true`, using its documented
[external-build workflow](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build.html#serverless-sam-cli-using-build-skip).
This avoids an independent npm install attempting to resolve pnpm `workspace:*`
dependencies and requires neither Docker nor Make.

Required Lambda environment: `STAGE`, `DEVICES_TABLE`, `TELEMETRY_TABLE`.
The template creates exactly three DynamoDB tables and an IoT Topic Rule with
invocation permission restricted to that rule and the current AWS account.
Its explicit execution role permits telemetry `PutItem`, devices `GetItem`
and `UpdateItem`, and logging to this function's pre-created log group only.
The only IAM resource wildcard covers log streams within that specific group.

## Foundation limitations

Telemetry and Devices writes remain separate. After a device load/update failure
or exhausted conflicts, redelivery can resume the device update even though the
telemetry record already exists. A fully processed retry returns `duplicate`;
an observation older than current `lastProcessedAt` returns `stale` without
rewinding state. The telemetry record's original receipt time and TTL are retained.
Recovery requires redelivery; no background repair is implemented. Before adding
incident persistence, address retry safety across those additional writes too.

This intermediate foundation can enter ACTIVE without creating an incident.
It is not yet the complete incident pipeline. Deployment, demo-device seeding,
IoT provisioning and deployed smoke testing require explicit execution; follow
`docs/21_DAY1_IOT_DEPLOYMENT.md`. The checked-in seed creates only an absent dev
device and preserves existing monitoring state on reruns.
