import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type LifecycleEventType = 'OPENED' | 'RESOLVED';

export class IncidentEventDispatchError extends Error {}

export interface IncidentEventStore {
  send(command: GetCommand | UpdateCommand): Promise<{ Item?: Record<string, unknown> }>;
}

export interface EventBridgePublisher {
  send(command: PutEventsCommand): Promise<{
    FailedEntryCount?: number;
    Entries?: Array<{
      EventId?: string;
      ErrorCode?: string;
      ErrorMessage?: string;
    }>;
  }>;
}

export interface IncidentEventLogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  operation: string;
  stage: string;
  [field: string]: unknown;
}

interface DispatchContext {
  stage: string;
  deviceId: string;
  eventId: string;
}

interface DispatchDependencies {
  db: IncidentEventStore;
  eventBridge: EventBridgePublisher;
  incidentsTable: string;
  log: (entry: IncidentEventLogEntry) => void;
}

interface OpenedDetail {
  schemaVersion: 1;
  incidentId: string;
  deviceId: string;
  openedAt: string;
  breachStartedAt: string;
  thresholdC: number;
  breachGraceSeconds: number;
  temperatureAtOpenC: number;
  peakTemperatureC: number;
  doorState: string;
  powerState: string;
}

interface ResolvedDetail {
  schemaVersion: 1;
  incidentId: string;
  deviceId: string;
  openedAt: string;
  resolvedAt: string;
  durationSeconds: number;
  peakTemperatureC: number;
}

function isConditionalConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error &&
    error.name === 'ConditionalCheckFailedException';
}

function requiredString(incident: Record<string, unknown>, field: string): string {
  const value = incident[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Incident ${field} is invalid`);
  }
  return value;
}

function requiredNumber(incident: Record<string, unknown>, field: string): number {
  const value = incident[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Incident ${field} is invalid`);
  }
  return value;
}

function dispatchStatus(incident: Record<string, unknown>, eventType: LifecycleEventType): unknown {
  return eventType === 'OPENED'
    ? incident.openedEventDispatchStatus
    : incident.resolvedEventDispatchStatus;
}

function eventDetail(
  incident: Record<string, unknown>,
  eventType: LifecycleEventType,
): OpenedDetail | ResolvedDetail {
  const incidentId = requiredString(incident, 'incidentId');
  const deviceId = requiredString(incident, 'deviceId');
  const openedAt = requiredString(incident, 'openedAt');

  if (eventType === 'OPENED') {
    const temperatureAtOpenC = requiredNumber(incident, 'temperatureAtOpenC');
    return {
      schemaVersion: 1,
      incidentId,
      deviceId,
      openedAt,
      breachStartedAt: requiredString(incident, 'breachStartedAt'),
      thresholdC: requiredNumber(incident, 'thresholdC'),
      breachGraceSeconds: requiredNumber(incident, 'breachGraceSeconds'),
      temperatureAtOpenC,
      peakTemperatureC: temperatureAtOpenC,
      doorState: requiredString(incident, 'doorStateAtOpen'),
      powerState: requiredString(incident, 'powerStateAtOpen'),
    };
  }

  if (incident.status !== 'RESOLVED') throw new Error('Incident is not resolved');
  return {
    schemaVersion: 1,
    incidentId,
    deviceId,
    openedAt,
    resolvedAt: requiredString(incident, 'resolvedAt'),
    durationSeconds: requiredNumber(incident, 'durationSeconds'),
    peakTemperatureC: requiredNumber(incident, 'peakTemperatureC'),
  };
}

async function loadIncident(
  db: IncidentEventStore,
  incidentsTable: string,
  incidentId: string,
): Promise<Record<string, unknown>> {
  const response = await db.send(new GetCommand({
    TableName: incidentsTable,
    Key: { incidentId },
    ConsistentRead: true,
  }));
  if (!response.Item) throw new Error('Incident dispatch record is missing');
  return response.Item;
}

export async function dispatchIncidentLifecycleEvent(
  dependencies: DispatchDependencies,
  incidentId: string,
  eventType: LifecycleEventType,
  context: DispatchContext,
  persistedIncident?: Record<string, unknown>,
): Promise<'published' | 'already_sent'> {
  const { db, eventBridge, incidentsTable, log } = dependencies;
  const logContext = { ...context, incidentId, eventType };
  let incident: Record<string, unknown>;
  try {
    incident = persistedIncident ?? await loadIncident(db, incidentsTable, incidentId);
    if (incident.incidentId !== incidentId || incident.deviceId !== context.deviceId) {
      throw new Error('Incident dispatch reference is invalid');
    }
    const status = dispatchStatus(incident, eventType);
    if (status === 'SENT') {
      log({ level: 'INFO', operation: 'incident_event_already_sent', ...logContext,
        result: 'already_sent' });
      return 'already_sent';
    }
    if (status !== 'PENDING') throw new Error('Incident dispatch status is invalid');
  } catch {
    log({ level: 'ERROR', operation: 'eventbridge_dispatch_failed', ...logContext,
      result: 'invalid_incident' });
    throw new IncidentEventDispatchError('Incident event dispatch failed');
  }

  const detailType = eventType === 'OPENED'
    ? 'freshguard.incident.opened'
    : 'freshguard.incident.resolved';
  let detail: OpenedDetail | ResolvedDetail;
  try {
    detail = eventDetail(incident, eventType);
  } catch {
    log({ level: 'ERROR', operation: 'eventbridge_dispatch_failed', ...logContext,
      result: 'invalid_incident' });
    throw new IncidentEventDispatchError('Incident event dispatch failed');
  }

  try {
    const response = await eventBridge.send(new PutEventsCommand({ Entries: [{
      Source: 'freshguard.incidents',
      DetailType: detailType,
      Detail: JSON.stringify(detail),
    }] }));
    const entry = response.Entries?.[0];
    if ((response.FailedEntryCount ?? 0) > 0 || !entry?.EventId ||
      entry.ErrorCode !== undefined || entry.ErrorMessage !== undefined) {
      log({ level: 'ERROR', operation: 'eventbridge_dispatch_failed', ...logContext,
        result: 'entry_failed', errorCode: entry?.ErrorCode });
      throw new IncidentEventDispatchError('Incident event dispatch failed');
    }
  } catch (error) {
    if (error instanceof IncidentEventDispatchError) throw error;
    log({ level: 'ERROR', operation: 'eventbridge_dispatch_failed', ...logContext,
      result: 'request_failed' });
    throw new IncidentEventDispatchError('Incident event dispatch failed');
  }

  const marker = eventType === 'OPENED'
    ? 'openedEventDispatchStatus'
    : 'resolvedEventDispatchStatus';
  try {
    await db.send(new UpdateCommand({
      TableName: incidentsTable,
      Key: { incidentId },
      UpdateExpression: eventType === 'OPENED'
        ? 'SET openedEventDispatchStatus = :sent, eventDispatchStatus = :sent'
        : 'SET resolvedEventDispatchStatus = :sent',
      ConditionExpression: '#marker = :pending',
      ExpressionAttributeNames: { '#marker': marker },
      ExpressionAttributeValues: { ':pending': 'PENDING', ':sent': 'SENT' },
    }));
  } catch (error) {
    if (isConditionalConflict(error)) {
      try {
        const current = await loadIncident(db, incidentsTable, incidentId);
        if (dispatchStatus(current, eventType) === 'SENT') {
          log({ level: 'INFO', operation: 'incident_event_already_sent', ...logContext,
            result: 'already_sent' });
          return 'already_sent';
        }
      } catch {
        // Report the generic persistence failure below.
      }
    }
    log({ level: 'ERROR', operation: 'eventbridge_dispatch_failed', ...logContext,
      result: 'status_update_failed' });
    throw new IncidentEventDispatchError('Incident event dispatch status update failed');
  }

  log({ level: 'INFO', operation: 'incident_event_published', ...logContext,
    result: 'published' });
  return 'published';
}
