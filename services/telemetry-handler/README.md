# Telemetry and incident handler

Consumes decoded IoT telemetry using `@freshguard/contracts` validation and
`@freshguard/domain` evaluation. Tests inject document and EventBridge clients,
a clock and logger;
no AWS account or credentials are needed for unit tests.

Processing order: validate, conditionally persist telemetry, consistently read
the configured device, evaluate, then conditionally update state and any active
incident. A duplicate telemetry write skips storage only; device processing
continues. If `latest.eventId` matches the incoming event, reconcile pending
lifecycle dispatch before returning `duplicate` without a second device update.
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
from receipt.

`OPEN_INCIDENT`, `UPDATE_INCIDENT`, and `RESOLVE_INCIDENT` actions persist the
incident and Device changes atomically with DynamoDB transactions. Incident IDs
are deterministic base64url encodings of the device ID and winning opening event
ID, prefixed with `inc_`. Opening sets notification and AI status to `PENDING`.
`activeIncidentId`
is present only in `ACTIVE` and `RECOVERING` and is removed on resolution.

Opened and resolved EventBridge events have independent internal markers:
`openedEventDispatchStatus` and `resolvedEventDispatchStatus`. The original
`eventDispatchStatus` remains a compatibility alias for the opened marker. Device
fields `latestLifecycleIncidentId`, `latestLifecycleEventId`, and
`latestLifecycleEventType` let duplicate or stale telemetry reconcile the most
recent lifecycle dispatch after `activeIncidentId` is removed. A resolution
reconciles its incident's opened event before persisting and emitting the resolved
event, so a pending opening cannot be lost.

EventBridge delivery is at least once. The handler never intentionally publishes
a marker already recorded as `SENT`, but a process failure after EventBridge
acceptance and before the conditional DynamoDB status update can cause a retry to
publish again. Consumers must use `incidentId` as their business/idempotency key.

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

Required Lambda environment: `STAGE`, `DEVICES_TABLE`, `TELEMETRY_TABLE`,
`INCIDENTS_TABLE`.
The template creates exactly three DynamoDB tables and an IoT Topic Rule with
invocation permission restricted to that rule and the current AWS account.
Its explicit execution role permits telemetry `PutItem`, required Device and
Incident reads/updates, `TransactWriteItems` scoped to Devices and Incidents,
`events:PutEvents` scoped to the account's default bus, and logging to this
function's pre-created log group only.
The only IAM resource wildcard covers log streams within that specific group.

## Foundation limitations

Telemetry and Devices writes remain separate. After a device load/update failure
or exhausted conflicts, redelivery can resume the device update even though the
telemetry record already exists. A fully processed retry returns `duplicate`;
an observation older than current `lastProcessedAt` returns `stale` without
rewinding state. The telemetry record's original receipt time and TTL are retained.
Recovery requires redelivery; no background repair is implemented. Incident and
Device lifecycle mutations are atomic, so a retry cannot observe only one side of
an opening, active update, or resolution.

Notifications, API access and AI enrichment remain later milestones. Deployment,
demo-device seeding,
IoT provisioning and deployed smoke testing require explicit execution; follow
`docs/21_DAY1_IOT_DEPLOYMENT.md`. The checked-in seed creates only an absent dev
device and preserves existing monitoring state on reruns.
