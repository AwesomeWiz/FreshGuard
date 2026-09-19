# FreshGuard Read API

Public, read-only HTTP API for dashboard access to FreshGuard devices, telemetry, and incidents.

The Lambda uses explicit DTO mappings and has no DynamoDB write permissions. Configure browser origins with the comma-separated `ALLOWED_WEB_ORIGINS` environment variable; localhost is enabled by default in SAM.

Telemetry queries default to 30 minutes and 300 items, with hard maxima of 1,440 minutes and 300 items. Incident history defaults to 10 items with a hard maximum of 50. Values outside those bounds return `400 INVALID_QUERY`.

Device IDs follow the shared 1–64 character rule: letters, digits, underscores, and hyphens, beginning with a letter or digit. Incident IDs are bounded to 128 characters and accept the identifier characters used by the deterministic `inc_` IDs.
