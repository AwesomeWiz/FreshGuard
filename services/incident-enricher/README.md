# FreshGuard Incident Enricher

An asynchronous EventBridge consumer that enriches an existing incident with a grounded Amazon Bedrock explanation. It never creates incidents and does not participate in telemetry detection or SNS notification delivery.

The worker conditionally claims `PENDING` incidents as `GENERATING`, then saves `READY` with `aiExplanation` and `aiGeneratedAt`, or `FAILED` with a null explanation. `READY`, `GENERATING`, and `FAILED` deliveries are controlled no-ops. `FAILED` is terminal for this hackathon milestone; there is no automatic model retry policy.

`BEDROCK_MODEL_ID` must name a foundation model available in the deployed region that supports the Bedrock Converse API. No model access is assumed by the automated tests.
