import { parseTelemetryPayload } from '@freshguard/contracts';
import {
  evaluateMonitoringState,
  type DeviceConfig,
  type DeviceMonitoringState,
} from '@freshguard/domain';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

type Command = GetCommand | PutCommand | UpdateCommand;
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
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

type Device = DeviceConfig & DeviceMonitoringState & { version: number };
type Outcome = 'validation_failed' | 'duplicate' | 'device_not_found' | 'stale' | 'updated';

function isConditionalConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'name' in error && error.name === 'ConditionalCheckFailedException';
}

// Seeded records may omit empty windows; configuration and version must exist.
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
  };
}

export function createTelemetryHandler({
  db, stage, devicesTable, telemetryTable,
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

    try {
      await db.send(new PutCommand({
        TableName: telemetryTable,
        Item: { ...reading, sampleKey: `${observedAt}#${eventId}`, receivedAt,
          ttl: Math.floor(Date.parse(receivedAt) / 1000) + 7 * 24 * 60 * 60 },
        ConditionExpression: 'attribute_not_exists(sampleKey)',
      }));
    } catch (error) {
      if (!isConditionalConflict(error)) {
        log({ level: 'ERROR', operation: 'telemetry_persist_failed', ...context, result: 'failed' });
        throw new Error('Telemetry persistence failed');
      }
      log({ level: 'INFO', operation: 'telemetry_duplicate', ...context, result: 'storage_duplicate' });
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      let device: Device;
      try {
        const response = await db.send(new GetCommand({
          TableName: devicesTable, Key: { deviceId }, ConsistentRead: true,
        }));
        if (!response.Item) {
          log({ level: 'WARN', operation: 'device_not_found', ...context, result: 'device_not_found' });
          return { result: 'device_not_found' };
        }
        // Storage deduplication alone does not prove the Devices update completed.
        // Check every fresh read, including after another invocation wins a conflict.
        const latest = response.Item.latest;
        if (typeof latest === 'object' && latest !== null &&
          'eventId' in latest && latest.eventId === eventId) {
          log({ level: 'INFO', operation: 'telemetry_duplicate', ...context, result: 'duplicate' });
          return { result: 'duplicate' };
        }
        device = readDevice(response.Item);
      } catch {
        log({ level: 'ERROR', operation: 'device_load_failed', ...context, result: 'failed' });
        throw new Error('Device configuration or state could not be loaded');
      }

      const previous: DeviceMonitoringState = {
        monitoringState: device.monitoringState,
        breachStartedAt: device.breachStartedAt,
        recoveryStartedAt: device.recoveryStartedAt,
        lastProcessedAt: device.lastProcessedAt,
      };
      const evaluation = evaluateMonitoringState({ previous, reading, config: device });
      // The pure evaluator returns the previous object for an older observation.
      if (evaluation.next === previous) {
        log({ level: 'INFO', operation: 'telemetry_stale', ...context, result: 'stale' });
        return { result: 'stale' };
      }

      const { deviceId: latestDeviceId, ...latest } = reading;
      try {
        await db.send(new UpdateCommand({
          TableName: devicesTable,
          Key: { deviceId },
          UpdateExpression: 'SET #state = :state, breachStartedAt = :breach, recoveryStartedAt = :recovery, lastProcessedAt = :processed, lastSeenAt = :seen, latest = :latest, #version = #version + :one',
          ConditionExpression: 'attribute_exists(deviceId) AND #version = :expectedVersion',
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
          },
        }));
      } catch (error) {
        if (!isConditionalConflict(error)) {
          log({ level: 'ERROR', operation: 'device_update_failed', ...context, result: 'failed' });
          throw new Error('Device state update failed');
        }
        log({ level: attempt === 3 ? 'ERROR' : 'WARN', operation: 'device_update_conflict',
          ...context, attempt, result: attempt === 3 ? 'exhausted' : 'retrying' });
        if (attempt === 3) throw new Error('Device state update conflict retries exhausted');
        continue;
      }

      log({ level: 'INFO', operation: 'state_transition', ...context,
        fromState: previous.monitoringState, toState: evaluation.next.monitoringState,
        action: evaluation.action.type, result: 'updated' });
      return { result: 'updated' };
    }
    throw new Error('Device state update did not complete');
  };
}
