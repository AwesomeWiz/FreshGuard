import { parseTelemetryPayload, type TelemetryPayload } from '@freshguard/contracts';
import {
  evaluateMonitoringState,
  type DeviceConfig,
  type DeviceMonitoringState,
  type EvaluationResult,
} from '@freshguard/domain';
import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  dispatchIncidentLifecycleEvent,
  IncidentEventDispatchError,
  type EventBridgePublisher,
  type LifecycleEventType,
} from './incident-events.js';

type Command = GetCommand | PutCommand | TransactWriteCommand | UpdateCommand;
export interface DocumentClient {
  send(command: Command): Promise<{ Item?: Record<string, unknown> }>;
}

export interface LogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  operation: string;
  stage: string;
  [field: string]: unknown;
}

export interface HandlerDependencies {
  db: DocumentClient;
  stage: string;
  devicesTable: string;
  telemetryTable: string;
  incidentsTable: string;
  eventBridge: EventBridgePublisher;
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

type Device = DeviceConfig & DeviceMonitoringState & {
  version: number;
  activeIncidentId: string | null;
  latestLifecycleIncidentId: string | null;
  latestLifecycleEventId: string | null;
  latestLifecycleEventType: LifecycleEventType | null;
};
type Outcome = 'validation_failed' | 'duplicate' | 'device_not_found' | 'stale' | 'updated';
type Reading = Omit<TelemetryPayload, 'schemaVersion'>;

class IncidentInvariantError extends Error {}

function isConcurrencyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'ConditionalCheckFailedException' ||
    error.name === 'TransactionCanceledException' ||
    error.name === 'TransactionConflictException';
}

// Seeded records may omit empty windows and activeIncidentId; configuration and version must exist.
function readDevice(item: Record<string, unknown>): Device {
  const states = ['NORMAL', 'WATCHING', 'ACTIVE', 'RECOVERING'];
  const configFields = ['maxTemperatureC', 'breachGraceSeconds', 'recoveryGraceSeconds', 'staleAfterSeconds'] as const;
  if (typeof item.monitoringState !== 'string' || !states.includes(item.monitoringState) ||
    !Number.isSafeInteger(item.version) || (item.version as number) < 0 ||
    configFields.some((field) => typeof item[field] !== 'number' || !Number.isFinite(item[field]) ||
      (field !== 'maxTemperatureC' && (item[field] as number) < 0))) {
    throw new Error('Device configuration or state is invalid');
  }

  const timestamp = (field: string): string | null => {
    const value = item[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      throw new Error('Device state timestamp is invalid');
    }
    return value;
  };
  const activeIncidentId = item.activeIncidentId === undefined || item.activeIncidentId === null
    ? null
    : item.activeIncidentId;
  if (activeIncidentId !== null && (typeof activeIncidentId !== 'string' || activeIncidentId.length === 0)) {
    throw new IncidentInvariantError('activeIncidentId is invalid');
  }
  const ownsIncident = item.monitoringState === 'ACTIVE' || item.monitoringState === 'RECOVERING';
  if (ownsIncident !== (activeIncidentId !== null)) {
    throw new IncidentInvariantError('Device state and activeIncidentId disagree');
  }
  const lifecycleValues = [
    item.latestLifecycleIncidentId,
    item.latestLifecycleEventId,
    item.latestLifecycleEventType,
  ];
  const hasLifecycleReference = lifecycleValues.some((value) => value !== undefined && value !== null);
  if (hasLifecycleReference && (
    typeof item.latestLifecycleIncidentId !== 'string' || item.latestLifecycleIncidentId.length === 0 ||
    typeof item.latestLifecycleEventId !== 'string' || item.latestLifecycleEventId.length === 0 ||
    (item.latestLifecycleEventType !== 'OPENED' && item.latestLifecycleEventType !== 'RESOLVED')
  )) {
    throw new IncidentInvariantError('Device lifecycle dispatch reference is invalid');
  }

  return {
    monitoringState: item.monitoringState as Device['monitoringState'],
    maxTemperatureC: item.maxTemperatureC as number,
    breachGraceSeconds: item.breachGraceSeconds as number,
    recoveryGraceSeconds: item.recoveryGraceSeconds as number,
    staleAfterSeconds: item.staleAfterSeconds as number,
    breachStartedAt: timestamp('breachStartedAt'),
    recoveryStartedAt: timestamp('recoveryStartedAt'),
    lastProcessedAt: timestamp('lastProcessedAt'),
    version: item.version as number,
    activeIncidentId: activeIncidentId as string | null,
    latestLifecycleIncidentId: hasLifecycleReference ? item.latestLifecycleIncidentId as string : null,
    latestLifecycleEventId: hasLifecycleReference ? item.latestLifecycleEventId as string : null,
    latestLifecycleEventType: hasLifecycleReference
      ? item.latestLifecycleEventType as LifecycleEventType
      : null,
  };
}

export function incidentIdFor(deviceId: string, eventId: string): string {
  return `inc_${Buffer.from(`${deviceId}\0${eventId}`, 'utf8').toString('base64url')}`;
}

function deviceStateUpdate(
  devicesTable: string,
  deviceId: string,
  device: Device,
  evaluation: EvaluationResult,
  latest: Omit<Reading, 'deviceId'>,
  receivedAt: string,
  activeIncidentId?: string | null,
  lifecycleReference?: {
    incidentId: string;
    eventId: string;
    eventType: LifecycleEventType;
  },
) {
  const removeIncident = activeIncidentId === null;
  const setIncident = typeof activeIncidentId === 'string';
  return {
    TableName: devicesTable,
    Key: { deviceId },
    UpdateExpression: `SET #state = :state, breachStartedAt = :breach, recoveryStartedAt = :recovery, lastProcessedAt = :processed, lastSeenAt = :seen, latest = :latest, #version = #version + :one${setIncident ? ', activeIncidentId = :incidentId' : ''}${lifecycleReference ? ', latestLifecycleIncidentId = :lifecycleIncidentId, latestLifecycleEventId = :lifecycleEventId, latestLifecycleEventType = :lifecycleEventType' : ''}${removeIncident ? ' REMOVE activeIncidentId' : ''}`,
    ConditionExpression: `attribute_exists(deviceId) AND #version = :expectedVersion${evaluation.action.type === 'OPEN_INCIDENT' ? ' AND attribute_not_exists(activeIncidentId)' : ''}${evaluation.action.type === 'UPDATE_INCIDENT' || evaluation.action.type === 'RESOLVE_INCIDENT' ? ' AND activeIncidentId = :incidentId' : ''}`,
    ExpressionAttributeNames: { '#state': 'monitoringState', '#version': 'version' },
    ExpressionAttributeValues: {
      ':state': evaluation.next.monitoringState,
      ':breach': evaluation.next.breachStartedAt,
      ':recovery': evaluation.next.recoveryStartedAt,
      ':processed': evaluation.next.lastProcessedAt,
      ':seen': receivedAt,
      ':latest': latest,
      ':one': 1,
      ':expectedVersion': device.version,
      ...(setIncident || evaluation.action.type === 'UPDATE_INCIDENT' || evaluation.action.type === 'RESOLVE_INCIDENT'
        ? { ':incidentId': activeIncidentId ?? device.activeIncidentId }
        : {}),
      ...(lifecycleReference ? {
        ':lifecycleIncidentId': lifecycleReference.incidentId,
        ':lifecycleEventId': lifecycleReference.eventId,
        ':lifecycleEventType': lifecycleReference.eventType,
      } : {}),
    },
  };
}

async function readOpenIncident(
  db: DocumentClient,
  incidentsTable: string,
  incidentId: string,
  deviceId: string,
): Promise<{ item: Record<string, unknown>; openedAt: string; peakTemperatureC: number }> {
  const response = await db.send(new GetCommand({
    TableName: incidentsTable,
    Key: { incidentId },
    ConsistentRead: true,
  }));
  const incident = response.Item;
  if (!incident || incident.deviceId !== deviceId || incident.status !== 'OPEN' ||
    typeof incident.openedAt !== 'string' ||
    !Number.isFinite(Date.parse(incident.openedAt)) ||
    typeof incident.peakTemperatureC !== 'number' || !Number.isFinite(incident.peakTemperatureC)) {
    throw new IncidentInvariantError('Active incident is missing, resolved, or invalid');
  }
  return { item: incident, openedAt: incident.openedAt, peakTemperatureC: incident.peakTemperatureC };
}

export function createTelemetryHandler({
  db, stage, devicesTable, telemetryTable, incidentsTable, eventBridge,
  now = () => new Date(), log = (entry) => console.log(JSON.stringify(entry)),
}: HandlerDependencies) {
  return async (input: unknown): Promise<{ result: Outcome }> => {
    const parsed = parseTelemetryPayload(input);
    if (!parsed.success) {
      log({ level: 'WARN', stage, operation: 'telemetry_validation_failed',
        result: 'validation_failed', ...parsed.error });
      return { result: 'validation_failed' };
    }

    const { schemaVersion, ...reading } = parsed.data;
    const { deviceId, eventId, observedAt } = reading;
    const context = { stage, deviceId, eventId };
    log({ level: 'INFO', operation: 'telemetry_received', ...context, result: 'received' });
    const receivedAt = now().toISOString();
    const dispatch = (
      incidentId: string,
      eventType: LifecycleEventType,
      persistedIncident?: Record<string, unknown>,
    ) => dispatchIncidentLifecycleEvent(
      { db, eventBridge, incidentsTable, log },
      incidentId,
      eventType,
      context,
      persistedIncident,
    );

    try {
      await db.send(new PutCommand({
        TableName: telemetryTable,
        Item: { ...reading, sampleKey: `${observedAt}#${eventId}`, receivedAt,
          ttl: Math.floor(Date.parse(receivedAt) / 1000) + 7 * 24 * 60 * 60 },
        ConditionExpression: 'attribute_not_exists(sampleKey)',
      }));
    } catch (error) {
      if (!isConcurrencyConflict(error)) {
        log({ level: 'ERROR', operation: 'telemetry_persist_failed', ...context, result: 'failed' });
        throw new Error('Telemetry persistence failed');
      }
      log({ level: 'INFO', operation: 'telemetry_duplicate', ...context, result: 'storage_duplicate' });
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      let device: Device;
      let storedDevice: Record<string, unknown>;
      let isExactDuplicate = false;
      try {
        const response = await db.send(new GetCommand({
          TableName: devicesTable, Key: { deviceId }, ConsistentRead: true,
        }));
        if (!response.Item) {
          log({ level: 'WARN', operation: 'device_not_found', ...context, result: 'device_not_found' });
          return { result: 'device_not_found' };
        }
        storedDevice = response.Item;
        device = readDevice(storedDevice);
        const latest = storedDevice.latest;
        if (typeof latest === 'object' && latest !== null &&
          'eventId' in latest && latest.eventId === eventId) {
          isExactDuplicate = true;
        }
      } catch (error) {
        if (error instanceof IncidentInvariantError) {
          log({ level: 'ERROR', operation: 'incident_invariant_failed', ...context, result: 'failed' });
          throw new Error('Incident lifecycle invariant violated');
        }
        log({ level: 'ERROR', operation: 'device_load_failed', ...context, result: 'failed' });
        throw new Error('Device configuration or state could not be loaded');
      }
      if (isExactDuplicate) {
        if (device.latestLifecycleEventId === eventId &&
          device.latestLifecycleIncidentId && device.latestLifecycleEventType) {
          await dispatch(device.latestLifecycleIncidentId, device.latestLifecycleEventType);
        }
        log({ level: 'INFO', operation: 'telemetry_duplicate', ...context, result: 'duplicate' });
        return { result: 'duplicate' };
      }

      const previous: DeviceMonitoringState = {
        monitoringState: device.monitoringState,
        breachStartedAt: device.breachStartedAt,
        recoveryStartedAt: device.recoveryStartedAt,
        lastProcessedAt: device.lastProcessedAt,
      };
      const evaluation = evaluateMonitoringState({ previous, reading, config: device });
      if (evaluation.next === previous) {
        if (device.latestLifecycleEventId === eventId &&
          device.latestLifecycleIncidentId && device.latestLifecycleEventType) {
          await dispatch(device.latestLifecycleIncidentId, device.latestLifecycleEventType);
        }
        log({ level: 'INFO', operation: 'telemetry_stale', ...context, result: 'stale' });
        return { result: 'stale' };
      }

      const { deviceId: latestDeviceId, ...latest } = reading;
      let incidentId: string | null = null;
      let persistedLifecycleIncident: Record<string, unknown> | undefined;
      let lifecycleEventType: LifecycleEventType | null = null;
      try {
        switch (evaluation.action.type) {
          case 'OPEN_INCIDENT': {
            if (device.activeIncidentId !== null) {
              throw new IncidentInvariantError('Cannot open a second active incident');
            }
            if (device.latestLifecycleIncidentId && device.latestLifecycleEventType) {
              await dispatch(device.latestLifecycleIncidentId, device.latestLifecycleEventType);
            }
            incidentId = incidentIdFor(deviceId, eventId);
            const incident = {
              incidentId,
              deviceId,
              status: 'OPEN',
              openedAt: evaluation.action.openedAt,
              resolvedAt: null,
              breachStartedAt: evaluation.next.breachStartedAt,
              thresholdC: device.maxTemperatureC,
              breachGraceSeconds: device.breachGraceSeconds,
              recoveryGraceSeconds: device.recoveryGraceSeconds,
              temperatureAtOpenC: reading.temperatureC,
              latestTemperatureC: reading.temperatureC,
              peakTemperatureC: reading.temperatureC,
              doorStateAtOpen: reading.doorState ?? 'UNKNOWN',
              powerStateAtOpen: reading.powerState ?? 'UNKNOWN',
              notificationStatus: 'PENDING',
              notificationSentAt: null,
              aiStatus: 'PENDING',
              aiExplanation: null,
              durationSeconds: null,
              eventDispatchStatus: 'PENDING',
              openedEventDispatchStatus: 'PENDING',
              resolvedEventDispatchStatus: 'NOT_REQUIRED',
            };
            await db.send(new TransactWriteCommand({ TransactItems: [
              { Put: { TableName: incidentsTable, Item: incident,
                ConditionExpression: 'attribute_not_exists(incidentId)' } },
              { Update: deviceStateUpdate(devicesTable, deviceId, device, evaluation,
                latest, receivedAt, incidentId,
                { incidentId, eventId, eventType: 'OPENED' }) },
            ] }));
            persistedLifecycleIncident = incident;
            lifecycleEventType = 'OPENED';
            break;
          }
          case 'UPDATE_INCIDENT': {
            if (device.activeIncidentId === null) {
              throw new IncidentInvariantError('ACTIVE or RECOVERING device has no incident');
            }
            incidentId = device.activeIncidentId;
            const incident = await readOpenIncident(db, incidentsTable, incidentId, deviceId);
            await db.send(new TransactWriteCommand({ TransactItems: [
              { Update: deviceStateUpdate(devicesTable, deviceId, device, evaluation,
                latest, receivedAt, incidentId) },
              { Update: {
                TableName: incidentsTable,
                Key: { incidentId },
                UpdateExpression: 'SET latestTemperatureC = :temperature, peakTemperatureC = :peak',
                ConditionExpression: '#status = :open AND deviceId = :deviceId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':temperature': reading.temperatureC,
                  ':peak': Math.max(incident.peakTemperatureC, reading.temperatureC),
                  ':open': 'OPEN',
                  ':deviceId': deviceId,
                },
              } },
            ] }));
            break;
          }
          case 'RESOLVE_INCIDENT': {
            if (device.activeIncidentId === null) {
              throw new IncidentInvariantError('RECOVERING device has no incident');
            }
            incidentId = device.activeIncidentId;
            await dispatch(incidentId, 'OPENED');
            const incident = await readOpenIncident(db, incidentsTable, incidentId, deviceId);
            const durationSeconds = Math.floor(
              (Date.parse(evaluation.action.resolvedAt) - Date.parse(incident.openedAt)) / 1000,
            );
            if (durationSeconds < 0) throw new IncidentInvariantError('Incident duration is negative');
            await db.send(new TransactWriteCommand({ TransactItems: [
              { Update: deviceStateUpdate(devicesTable, deviceId, device, evaluation,
                latest, receivedAt, null,
                { incidentId, eventId, eventType: 'RESOLVED' }) },
              { Update: {
                TableName: incidentsTable,
                Key: { incidentId },
                UpdateExpression: 'SET #status = :resolved, resolvedAt = :resolvedAt, durationSeconds = :duration, resolvedEventDispatchStatus = :pending',
                ConditionExpression: '#status = :open AND deviceId = :deviceId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':resolved': 'RESOLVED',
                  ':resolvedAt': evaluation.action.resolvedAt,
                  ':duration': durationSeconds,
                  ':open': 'OPEN',
                  ':deviceId': deviceId,
                  ':pending': 'PENDING',
                },
              } },
            ] }));
            persistedLifecycleIncident = {
              ...incident.item,
              status: 'RESOLVED',
              resolvedAt: evaluation.action.resolvedAt,
              durationSeconds,
              resolvedEventDispatchStatus: 'PENDING',
            };
            lifecycleEventType = 'RESOLVED';
            break;
          }
          case 'NONE':
            await db.send(new UpdateCommand(deviceStateUpdate(
              devicesTable, deviceId, device, evaluation, latest, receivedAt,
            )));
            break;
        }
      } catch (error) {
        if (error instanceof IncidentEventDispatchError) throw error;
        if (error instanceof IncidentInvariantError) {
          log({ level: 'ERROR', operation: 'incident_invariant_failed', ...context,
            incidentId, fromState: previous.monitoringState,
            toState: evaluation.next.monitoringState, result: 'failed' });
          throw new Error('Incident lifecycle invariant violated');
        }
        if (!isConcurrencyConflict(error)) {
          const incidentAction = evaluation.action.type !== 'NONE';
          log({ level: 'ERROR', operation: incidentAction ? 'incident_persist_failed' : 'device_update_failed',
            ...context, incidentId, result: 'failed' });
          throw new Error(incidentAction ? 'Incident lifecycle persistence failed' : 'Device state update failed');
        }
        log({ level: attempt === 3 ? 'ERROR' : 'WARN', operation: 'device_update_conflict',
          ...context, incidentId, attempt, result: attempt === 3 ? 'exhausted' : 'retrying' });
        if (attempt === 3) throw new Error('Device state update conflict retries exhausted');
        continue;
      }

      if (evaluation.action.type !== 'NONE') {
        const operation = evaluation.action.type === 'OPEN_INCIDENT' ? 'incident_opened'
          : evaluation.action.type === 'UPDATE_INCIDENT' ? 'incident_updated'
            : 'incident_resolved';
        log({ level: 'INFO', operation, ...context, incidentId,
          fromState: previous.monitoringState, toState: evaluation.next.monitoringState,
          result: 'updated' });
      }
      log({ level: 'INFO', operation: 'state_transition', ...context,
        fromState: previous.monitoringState, toState: evaluation.next.monitoringState,
        action: evaluation.action.type, result: 'updated' });
      if (incidentId && lifecycleEventType) {
        await dispatch(incidentId, lifecycleEventType, persistedLifecycleIncident);
      }
      return { result: 'updated' };
    }
    throw new Error('Device state update did not complete');
  };
}
