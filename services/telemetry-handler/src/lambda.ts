import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTelemetryHandler } from './index.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler = createTelemetryHandler({
  db,
  stage: requiredEnvironment('STAGE'),
  devicesTable: requiredEnvironment('DEVICES_TABLE'),
  telemetryTable: requiredEnvironment('TELEMETRY_TABLE'),
  incidentsTable: requiredEnvironment('INCIDENTS_TABLE'),
});
