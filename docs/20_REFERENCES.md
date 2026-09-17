# References and Official Sources

This file separates external facts from internal project decisions. Re-check current service pricing/model availability at implementation time.

## Hackathon

### First Commit overview

https://www.wemakedevs.org/aws/first-commit

Relevant points verified Sept 17, 2026:

- event Sept 17–20, 2026;
- Ship It is deployed on AWS with a URL;
- architecture and cost decisions matter for Ship It;
- judging criteria: Idea and Impact, Built on AWS, Learning, Execution, Demo Video;
- organizers explicitly prefer a small problem solved well and working execution over unfinished breadth.

### First Commit rules

https://www.wemakedevs.org/aws/first-commit/rules

Relevant points verified Sept 17, 2026:

- new project must be built during the event;
- AI coding tools are allowed and must be listed;
- AWS must actually be used and shown;
- submission includes public repo, <=3 minute demo video and short write-up;
- judges score submitted material; no live judging call;
- Amazon fast-track opportunity is separate from prizes and not guaranteed.

## AWS IoT Core

### Rules for AWS IoT

https://docs.aws.amazon.com/iot/latest/developerguide/iot-rules.html

AWS IoT rules can filter/augment MQTT data and route it to services including Lambda, DynamoDB, SNS, CloudWatch and others.

### Lambda rule action

https://docs.aws.amazon.com/iot/latest/developerguide/lambda-rule-action.html

AWS IoT can invoke a Lambda function asynchronously from an IoT rule; Lambda resource-based permission is required.

### MQTT payload guidance

https://docs.aws.amazon.com/iot/latest/developerguide/topicdata.html

AWS IoT allows application-defined MQTT payloads; JSON enables Rules Engine parsing.

### IoT rule tutorial

https://docs.aws.amazon.com/iot/latest/developerguide/iot-rules-tutorial.html

Official tutorials show MQTT messages routed through IoT rules into AWS services.

## AWS Lambda

### Node.js runtimes

https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html

As of Sept 17, 2026, Node.js 22 remains a supported Lambda runtime. Node.js 24 is also available; project uses Node 22 for compatibility with team environment.

### Event-driven architectures

https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html

AWS documentation discusses Lambda in event-driven architectures and event-based invocation patterns.

## Amazon EventBridge

https://docs.aws.amazon.com/eventbridge/

EventBridge is a serverless event bus used to route application/AWS events to targets and supports loosely coupled event-driven architectures.

## Amazon DynamoDB TTL

https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html

TTL marks per-item expiration time and DynamoDB deletes expired items asynchronously without consuming write throughput for the deletion.

## Additional AWS docs to consult during implementation

- AWS SAM: https://docs.aws.amazon.com/serverless-application-model/
- DynamoDB: https://docs.aws.amazon.com/amazondynamodb/
- Amazon SNS: https://docs.aws.amazon.com/sns/
- Amazon Bedrock: https://docs.aws.amazon.com/bedrock/
- API Gateway: https://docs.aws.amazon.com/apigateway/
- CloudWatch: https://docs.aws.amazon.com/cloudwatch/
- Amplify Hosting: https://docs.aws.amazon.com/amplify/

## Reference policy

When implementation details depend on a service feature, region, model ID, runtime or price, prefer current official AWS documentation over assumptions or old examples.
