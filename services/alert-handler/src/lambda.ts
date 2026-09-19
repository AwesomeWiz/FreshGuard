import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createAlertHandler } from './index.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function claimLeaseSeconds(): number {
  const value = Number(process.env.NOTIFICATION_CLAIM_LEASE_SECONDS ?? '60');
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('NOTIFICATION_CLAIM_LEASE_SECONDS must be a positive whole number');
  }
  return value;
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler = createAlertHandler({
  db,
  sns: new SNSClient({}),
  stage: requiredEnvironment('STAGE'),
  incidentsTable: requiredEnvironment('INCIDENTS_TABLE'),
  alertTopicArn: requiredEnvironment('ALERT_TOPIC_ARN'),
  claimLeaseSeconds: claimLeaseSeconds(),
});
