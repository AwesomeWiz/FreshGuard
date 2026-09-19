# Alert Handler

Consumes only `freshguard.incident.opened` events from EventBridge. It validates
the event, consistently loads the persisted incident, conditionally claims its
notification, publishes a concise SNS message, and records `SENT` with
`notificationSentAt`. It does not detect incidents, publish lifecycle events,
invoke Bedrock, or depend on the telemetry handler.

Notification claims use internal `SENDING`, `notificationClaimedAt`, and
`notificationClaimToken` fields. A 60-second lease exceeds the Lambda timeout.
Concurrent deliveries cannot both win the normal conditional claim. A fresh busy
claim fails retryably; a stale claim can be reclaimed. SNS failure conditionally
returns the claim to `PENDING`.

SNS delivery is at least once. If SNS accepts a notification and the process dies
before `SENT` is stored, a retry may publish again after the claim lease expires.
Once `SENT` is stored, the handler does not intentionally republish.

Required environment variables:

- `STAGE`
- `INCIDENTS_TABLE`
- `ALERT_TOPIC_ARN`
- `NOTIFICATION_CLAIM_LEASE_SECONDS`

After deployment, subscribe a team-controlled email endpoint to the SNS topic and
confirm the AWS subscription email before testing. No email address is stored in
the template or repository.
