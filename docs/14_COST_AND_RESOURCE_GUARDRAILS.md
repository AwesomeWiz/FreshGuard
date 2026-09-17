# Cost and Resource Guardrails

## 1. Goal

Demonstrate cost-aware architecture without spending time on an elaborate financial model whose exact prices vary by region/service tier.

## 2. Main cost decisions

### Serverless/on-demand

FreshGuard avoids always-on servers. Lambda, API Gateway, DynamoDB, EventBridge, IoT Core, SNS and Bedrock are usage-driven services.

### Bedrock only on incidents

Do **not** call a foundation model for each telemetry reading.

Bad design:

```text
12 readings/minute * devices * hours -> Bedrock every reading
```

FreshGuard design:

```text
telemetry -> deterministic code
incident transition -> Bedrock once
```

This is both cheaper and more correct.

### Short telemetry retention

Use DynamoDB TTL for demo telemetry such as 7 days. Incident records may be retained longer during judging.

### Short CloudWatch log retention

Set development log retention to a small value such as 3–7 days where easy through IaC.

### DynamoDB on-demand

Avoid capacity planning for the hackathon.

### Single Region

Avoid inter-region complexity/data transfer.

## 3. Resource count discipline

Do not add:

- EC2;
- RDS;
- OpenSearch;
- SageMaker;
- Step Functions;
- multiple agent frameworks;

unless a real requirement appears.

## 4. Cost monitoring

- check hackathon credits/account billing dashboard;
- stop aggressive simulator loops when not testing;
- cap simulator publish rate;
- cap public API query size;
- tear down nonessential resources after judging.

## 5. Demo answer to “how did you think about cost?”

A concise answer:

> We kept the per-reading path deterministic and serverless, and invoke Bedrock only on incident transitions rather than every sensor sample. Telemetry has short TTL retention, logs are short-lived, DynamoDB uses on-demand capacity, and the system has no always-on compute.

## 6. Do not quote an exact monthly production bill

The hackathon workload is tiny and production cost depends heavily on device count, publish frequency, retention, region, notification channel and model choice. If an exact estimate is later needed, use the current AWS Pricing Calculator with explicit assumptions.
