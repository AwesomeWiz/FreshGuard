import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createReadApiHandler } from './index.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler = createReadApiHandler({
  db,
  stage: requiredEnvironment('STAGE'),
  devicesTable: requiredEnvironment('DEVICES_TABLE'),
  telemetryTable: requiredEnvironment('TELEMETRY_TABLE'),
  incidentsTable: requiredEnvironment('INCIDENTS_TABLE'),
  incidentsByDeviceIndex: process.env.INCIDENTS_BY_DEVICE_INDEX ?? 'ByDeviceOpenedAt',
  allowedOrigins: (process.env.ALLOWED_WEB_ORIGINS ?? 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
});
