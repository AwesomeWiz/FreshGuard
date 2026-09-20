import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  buildEvidencePrompt,
  GROUNDED_SYSTEM_PROMPT,
  type IncidentEvidence,
} from './prompt.js';

type DbCommand = GetCommand | UpdateCommand;

export interface DocumentClient {
  send(command: DbCommand): Promise<{ Item?: Record<string, unknown> }>;
}

export interface BedrockRuntime {
  send(command: ConverseCommand): Promise<unknown>;
}

export interface IncidentOpenedEvent {
  id?: string;
  source?: string;
  'detail-type'?: string;
  detail?: unknown;
}

export interface LogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  operation:
    | 'enrichment_received'
    | 'enrichment_started'
    | 'enrichment_already_ready'
    | 'enrichment_claim_failed'
    | 'bedrock_succeeded'
    | 'bedrock_failed'
    | 'enrichment_saved'
    | 'enrichment_failed';
  stage: string;
  result: string;
  incidentId?: string;
  deviceId?: string;
  durationMs?: number;
}

export interface HandlerDependencies {
  db: DocumentClient;
  bedrock: BedrockRuntime;
  stage: string;
  incidentsTable: string;
  modelId: string;
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

type AiStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
type Outcome =
  | 'invalid_event'
  | 'incident_not_found'
  | 'invalid_incident'
  | 'already_ready'
  | 'in_progress'
  | 'already_failed'
  | 'ready'
  | 'failed';

interface ParsedEvent {
  incidentId: string;
  deviceId: string;
  openedAt: string;
}

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const INCIDENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

class InvalidIncidentError extends Error {}
class InvalidModelResponseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function parseEvent(input: unknown): ParsedEvent | null {
  if (!isRecord(input) || input.source !== 'freshguard.incidents' ||
      input['detail-type'] !== 'freshguard.incident.opened' || !isRecord(input.detail)) return null;
  const detail = input.detail;
  if (detail.schemaVersion !== 1 || typeof detail.incidentId !== 'string' ||
      !INCIDENT_ID.test(detail.incidentId) || typeof detail.deviceId !== 'string' ||
      !DEVICE_ID.test(detail.deviceId) || !isUtcTimestamp(detail.openedAt)) return null;
  return {
    incidentId: detail.incidentId,
    deviceId: detail.deviceId,
    openedAt: detail.openedAt,
  };
}

function requiredString(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== 'string' || value.length === 0) throw new InvalidIncidentError(`Invalid ${field}`);
  return value;
}

function requiredNumber(item: Record<string, unknown>, field: string): number {
  const value = item[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidIncidentError(`Invalid ${field}`);
  return value;
}

function aiStatus(item: Record<string, unknown>): AiStatus {
  const status = item.aiStatus;
  if (status !== 'PENDING' && status !== 'GENERATING' && status !== 'READY' && status !== 'FAILED') {
    throw new InvalidIncidentError('Invalid aiStatus');
  }
  return status;
}

function verifyIncident(item: Record<string, unknown>, event: ParsedEvent): AiStatus {
  if (item.incidentId !== event.incidentId || item.deviceId !== event.deviceId ||
      item.openedAt !== event.openedAt) throw new InvalidIncidentError('Incident does not match event');
  if (item.status !== 'OPEN' && item.status !== 'RESOLVED') {
    throw new InvalidIncidentError('Invalid incident status');
  }
  return aiStatus(item);
}

export function normalizeIncidentEvidence(item: Record<string, unknown>): IncidentEvidence {
  const openedAt = requiredString(item, 'openedAt');
  const breachStartedAt = requiredString(item, 'breachStartedAt');
  if (!isUtcTimestamp(openedAt) || !isUtcTimestamp(breachStartedAt)) {
    throw new InvalidIncidentError('Invalid incident timestamps');
  }
  const breachDurationSeconds = Math.floor((Date.parse(openedAt) - Date.parse(breachStartedAt)) / 1000);
  if (breachDurationSeconds < 0) throw new InvalidIncidentError('Invalid breach duration');

  const doorState = requiredString(item, 'doorStateAtOpen');
  const powerState = requiredString(item, 'powerStateAtOpen');
  if (doorState !== 'OPEN' && doorState !== 'CLOSED' && doorState !== 'UNKNOWN') {
    throw new InvalidIncidentError('Invalid door state');
  }
  if (powerState !== 'ON' && powerState !== 'OFF' && powerState !== 'UNKNOWN') {
    throw new InvalidIncidentError('Invalid power state');
  }

  return {
    deviceId: requiredString(item, 'deviceId'),
    incidentId: requiredString(item, 'incidentId'),
    openedAt,
    thresholdC: requiredNumber(item, 'thresholdC'),
    breachGraceSeconds: requiredNumber(item, 'breachGraceSeconds'),
    temperatureAtOpenC: requiredNumber(item, 'temperatureAtOpenC'),
    peakTemperatureC: requiredNumber(item, 'peakTemperatureC'),
    doorState,
    powerState,
    breachDurationSeconds,
  };
}

function conditionalConflict(error: unknown): boolean {
  return isRecord(error) && error.name === 'ConditionalCheckFailedException';
}

function modelText(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.output) || !isRecord(response.output.message) ||
      !Array.isArray(response.output.message.content)) throw new InvalidModelResponseError('Missing model content');
  const text = response.output.message.content
    .filter(isRecord)
    .map((block) => typeof block.text === 'string' ? block.text.trim() : '')
    .filter(Boolean)
    .join(' ')
    .trim();
  if (text.length === 0 || text.length > 1_200) throw new InvalidModelResponseError('Invalid model text');
  return text;
}

export async function generateExplanation(
  bedrock: BedrockRuntime,
  modelId: string,
  evidence: IncidentEvidence,
): Promise<string> {
  const response = await bedrock.send(new ConverseCommand({
    modelId,
    system: [{ text: GROUNDED_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: buildEvidencePrompt(evidence) }] }],
    inferenceConfig: { maxTokens: 240, temperature: 0 },
  }));
  return modelText(response);
}

async function loadIncident(
  db: DocumentClient,
  incidentsTable: string,
  incidentId: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await db.send(new GetCommand({
    TableName: incidentsTable,
    Key: { incidentId },
    ConsistentRead: true,
  }));
  return response.Item;
}

function claimCommand(incidentsTable: string, event: ParsedEvent) {
  return new UpdateCommand({
    TableName: incidentsTable,
    Key: { incidentId: event.incidentId },
    UpdateExpression: 'SET aiStatus = :generating, aiExplanation = :empty REMOVE aiGeneratedAt',
    ConditionExpression: 'incidentId = :incidentId AND deviceId = :deviceId AND openedAt = :openedAt AND aiStatus = :pending',
    ExpressionAttributeValues: {
      ':incidentId': event.incidentId,
      ':deviceId': event.deviceId,
      ':openedAt': event.openedAt,
      ':pending': 'PENDING',
      ':generating': 'GENERATING',
      ':empty': null,
    },
  });
}

function readyCommand(
  incidentsTable: string,
  event: ParsedEvent,
  explanation: string,
  generatedAt: string,
) {
  return new UpdateCommand({
    TableName: incidentsTable,
    Key: { incidentId: event.incidentId },
    UpdateExpression: 'SET aiStatus = :ready, aiExplanation = :explanation, aiGeneratedAt = :generatedAt',
    ConditionExpression: 'deviceId = :deviceId AND aiStatus = :generating',
    ExpressionAttributeValues: {
      ':deviceId': event.deviceId,
      ':generating': 'GENERATING',
      ':ready': 'READY',
      ':explanation': explanation,
      ':generatedAt': generatedAt,
    },
  });
}

function failedCommand(incidentsTable: string, event: ParsedEvent) {
  return new UpdateCommand({
    TableName: incidentsTable,
    Key: { incidentId: event.incidentId },
    UpdateExpression: 'SET aiStatus = :failed, aiExplanation = :empty REMOVE aiGeneratedAt',
    ConditionExpression: 'deviceId = :deviceId AND aiStatus = :generating',
    ExpressionAttributeValues: {
      ':deviceId': event.deviceId,
      ':generating': 'GENERATING',
      ':failed': 'FAILED',
      ':empty': null,
    },
  });
}

export function createIncidentEnricher({
  db, bedrock, stage, incidentsTable, modelId,
  now = () => new Date(),
  log = (entry) => console.log(JSON.stringify(entry)),
}: HandlerDependencies) {
  return async (input: unknown): Promise<{ result: Outcome }> => {
    const receivedAt = now().getTime();
    const event = parseEvent(input);
    if (!event) {
      log({ level: 'WARN', operation: 'enrichment_failed', stage, result: 'invalid_event' });
      return { result: 'invalid_event' };
    }
    const context = { stage, incidentId: event.incidentId, deviceId: event.deviceId };
    log({ level: 'INFO', operation: 'enrichment_received', ...context, result: 'received' });

    let incident: Record<string, unknown>;
    let status: AiStatus;
    try {
      const loaded = await loadIncident(db, incidentsTable, event.incidentId);
      if (!loaded) {
        log({ level: 'WARN', operation: 'enrichment_failed', ...context, result: 'incident_not_found' });
        return { result: 'incident_not_found' };
      }
      incident = loaded;
      status = verifyIncident(incident, event);
    } catch {
      log({ level: 'ERROR', operation: 'enrichment_failed', ...context, result: 'invalid_incident' });
      return { result: 'invalid_incident' };
    }

    if (status === 'READY') {
      log({ level: 'INFO', operation: 'enrichment_already_ready', ...context, result: 'already_ready' });
      return { result: 'already_ready' };
    }
    if (status === 'GENERATING') {
      log({ level: 'INFO', operation: 'enrichment_claim_failed', ...context, result: 'in_progress' });
      return { result: 'in_progress' };
    }
    // FAILED is terminal for this milestone. Retrying it requires an explicit future policy.
    if (status === 'FAILED') {
      log({ level: 'INFO', operation: 'enrichment_claim_failed', ...context, result: 'already_failed' });
      return { result: 'already_failed' };
    }

    let evidence: IncidentEvidence;
    try {
      evidence = normalizeIncidentEvidence(incident);
    } catch {
      log({ level: 'ERROR', operation: 'enrichment_failed', ...context, result: 'invalid_evidence' });
      return { result: 'invalid_incident' };
    }

    try {
      await db.send(claimCommand(incidentsTable, event));
    } catch (error) {
      if (conditionalConflict(error)) {
        try {
          const current = await loadIncident(db, incidentsTable, event.incidentId);
          if (current) {
            const currentStatus = verifyIncident(current, event);
            const result = currentStatus === 'READY' ? 'already_ready'
              : currentStatus === 'GENERATING' ? 'in_progress'
                : currentStatus === 'FAILED' ? 'already_failed' : 'failed';
            log({
              level: result === 'failed' ? 'WARN' : 'INFO',
              operation: result === 'already_ready' ? 'enrichment_already_ready' : 'enrichment_claim_failed',
              ...context,
              result,
            });
            return { result };
          }
        } catch {
          // Report the controlled claim failure below.
        }
      }
      log({ level: 'ERROR', operation: 'enrichment_claim_failed', ...context, result: 'claim_failed' });
      return { result: 'failed' };
    }
    log({ level: 'INFO', operation: 'enrichment_started', ...context, result: 'generating' });

    let explanation: string;
    try {
      explanation = await generateExplanation(bedrock, modelId, evidence);
      log({ level: 'INFO', operation: 'bedrock_succeeded', ...context, result: 'generated',
        durationMs: Math.max(0, now().getTime() - receivedAt) });
    } catch {
      log({ level: 'ERROR', operation: 'bedrock_failed', ...context, result: 'generation_failed',
        durationMs: Math.max(0, now().getTime() - receivedAt) });
      try {
        await db.send(failedCommand(incidentsTable, event));
      } catch {
        log({ level: 'ERROR', operation: 'enrichment_failed', ...context, result: 'failed_status_not_saved' });
        return { result: 'failed' };
      }
      log({ level: 'WARN', operation: 'enrichment_failed', ...context, result: 'failed' });
      return { result: 'failed' };
    }

    try {
      await db.send(readyCommand(incidentsTable, event, explanation, now().toISOString()));
    } catch {
      log({ level: 'ERROR', operation: 'enrichment_failed', ...context, result: 'ready_status_not_saved' });
      try {
        await db.send(failedCommand(incidentsTable, event));
      } catch {
        // The conditional update prevents overwriting a concurrent terminal state.
      }
      return { result: 'failed' };
    }
    log({ level: 'INFO', operation: 'enrichment_saved', ...context, result: 'ready' });
    return { result: 'ready' };
  };
}
