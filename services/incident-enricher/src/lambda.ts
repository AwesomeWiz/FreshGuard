import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createIncidentEnricher } from './index.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler = createIncidentEnricher({
  db,
  bedrock: new BedrockRuntimeClient({}),
  stage: requiredEnvironment('STAGE'),
  incidentsTable: requiredEnvironment('INCIDENTS_TABLE'),
  modelId: requiredEnvironment('BEDROCK_MODEL_ID'),
});
