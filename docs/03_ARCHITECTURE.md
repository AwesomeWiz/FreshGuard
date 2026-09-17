# Architecture

## 1. Architecture objective

FreshGuard should look and behave like a small production event-processing system, not a generic dashboard with an LLM attached.

## 2. System context

```mermaid
flowchart LR
    Operator[Cold-storage operator]
    Simulator[Python device simulator]
    FreshGuard[FreshGuard on AWS]
    Alert[Email/SNS endpoint]

    Simulator -->|MQTT telemetry| FreshGuard
    Operator -->|Views deployed dashboard| FreshGuard
    FreshGuard -->|Incident notification| Alert
    FreshGuard -->|Status, evidence, history| Operator
```

## 3. Container/component architecture

```mermaid
flowchart TB
    SIM[Python MQTT Simulator]
    IOT[AWS IoT Core]
    RULE[IoT Topic Rule]
    TH[Telemetry Handler Lambda]
    DEV[(DynamoDB Devices)]
    TEL[(DynamoDB Telemetry)]
    INC[(DynamoDB Incidents)]
    EB[Amazon EventBridge]
    ALERT[Alert Handler Lambda]
    SNS[Amazon SNS]
    ENRICH[Incident Enricher Lambda]
    BR[Amazon Bedrock]
    API[API Gateway + Read API Lambda]
    WEB[Next.js Dashboard]
    AMP[AWS Amplify Hosting]
    CW[Amazon CloudWatch]

    SIM -->|MQTT/TLS| IOT
    IOT --> RULE --> TH
    TH --> TEL
    TH <--> DEV
    TH <--> INC
    TH -->|incident domain events| EB
    EB --> ALERT --> SNS
    EB --> ENRICH --> BR
    ENRICH --> INC
    API --> DEV
    API --> TEL
    API --> INC
    AMP --> WEB
    WEB -->|HTTPS polling| API
    TH --> CW
    ALERT --> CW
    ENRICH --> CW
    API --> CW
```

## 4. Incident-open sequence

```mermaid
sequenceDiagram
    participant S as Simulator
    participant I as AWS IoT Core
    participant T as Telemetry Lambda
    participant D as DynamoDB
    participant E as EventBridge
    participant A as Alert Lambda/SNS
    participant B as Enricher/Bedrock
    participant W as Web Dashboard

    S->>I: MQTT telemetry above configured threshold
    I-->>T: Async rule invocation
    T->>D: Put telemetry (idempotent)
    T->>D: Read current device/config state
    T->>T: Evaluate deterministic state machine
    T->>D: Update WATCHING/ACTIVE state
    Note over T,D: When grace duration is satisfied
    T->>D: Create one OPEN incident
    T->>E: freshguard.incident.opened
    par Independent consumers
        E-->>A: Incident opened event
        A->>A: Publish SNS alert
    and
        E-->>B: Incident opened event
        B->>B: Build evidence-only prompt
        B->>B: Call Bedrock
        B->>D: Save explanation/status
    end
    W->>D: via API polling
    W-->>W: Render incident and evidence
```

## 5. Recovery sequence

```mermaid
sequenceDiagram
    participant S as Simulator
    participant I as AWS IoT Core
    participant T as Telemetry Lambda
    participant D as DynamoDB
    participant E as EventBridge
    participant W as Web Dashboard

    S->>I: temperature <= configured threshold
    I-->>T: telemetry event
    T->>T: ACTIVE -> RECOVERING
    T->>D: store recoveryStartedAt
    S->>I: continued recovered readings
    I-->>T: telemetry event
    T->>T: recovery duration satisfied
    T->>D: Resolve same incident
    T->>D: device state -> NORMAL
    T->>E: freshguard.incident.resolved
    W->>W: show RESOLVED, duration, peak
```

## 6. Failure-isolation architecture

The critical safety/operational path is intentionally separated from AI enrichment:

```mermaid
flowchart LR
    DETECT[Deterministic detection]
    STORE[Persist incident]
    EVENT[Emit incident event]
    ALERT[Notify]
    AI[Bedrock explanation]

    DETECT --> STORE --> EVENT
    EVENT --> ALERT
    EVENT --> AI

    AIFAIL[If Bedrock fails]
    AI -.-> AIFAIL
    AIFAIL -.->|No rollback| STORE
```

The desired property is:

> **AI failure degrades explanation quality, not incident correctness.**

## 7. Data ownership

- **Telemetry table** owns immutable/recent sample facts.
- **Devices table** owns mutable current configuration and monitoring state.
- **Incidents table** owns the lifecycle record for each incident.
- **Bedrock output** is stored as enrichment on the incident, never as the source of the incident.

## 8. Trust boundaries

### Device boundary

The simulator possesses its own local certificate/private key and can publish only to the permitted telemetry topic.

### Cloud backend boundary

Lambda roles perform AWS mutations. The browser does not receive AWS credentials.

### Public UI boundary

The deployed dashboard consumes read-only HTTP endpoints. It cannot publish telemetry, edit thresholds, resolve incidents, invoke Bedrock, or publish SNS messages in P0.

## 9. Why each AWS service exists

### AWS IoT Core

Provides MQTT device ingress and routes topic messages into AWS services. It is the production-shaped replacement for writing a custom MQTT broker.

### Lambda

Runs stateless validation, deterministic event processing and API handlers with no always-on server.

### DynamoDB

Stores current device state, recent telemetry and incident lifecycle records with serverless scaling and simple key-based access patterns.

### EventBridge

Decouples the detector from independent incident consumers. Adding another incident consumer later should not require changing the detector contract.

### SNS

Provides a real external notification path visible in the demo.

### Bedrock

Adds grounded natural-language incident explanation from structured evidence. It is deliberately not invoked for every reading.

### API Gateway

Provides an HTTP boundary between the public dashboard and private AWS data services.

### Amplify Hosting

Provides the deployed frontend URL required for the Ship It presentation.

### CloudWatch

Makes the system diagnosable and proves operational awareness in the demo/repository.

### SAM

Keeps architecture reproducible, reviewable and version-controlled.

## 10. Architecture constraints

- No physical hardware is required.
- No long-running EC2 server.
- No autonomous equipment control.
- No client-side AWS secret credentials.
- No Bedrock call in the per-reading path.
- No requirement for WebSockets.
- No manual incident creation in P0.

## 11. Future-production evolution (not P0)

A real deployment might add:

- device fleet provisioning/rotation;
- IoT Device Defender;
- Device Shadow;
- SQS/DLQs between critical consumers;
- stronger exactly-once business semantics using transactions/idempotency store;
- Amazon Timestream or S3 analytics for long telemetry retention;
- Cognito and tenant/site authorization;
- calibrated sensors and gateway connectivity;
- escalation policies;
- audit exports;
- dashboards/alarms for backend SLOs;
- regional resilience.

Do not implement these simply to increase the AWS-service count during the hackathon.
