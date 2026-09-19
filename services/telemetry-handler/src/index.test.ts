import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createTelemetryHandler, incidentIdFor, type DocumentClient, type LogEntry } from './index.js';

const reading = {
  schemaVersion: 1, eventId: 'event-01', deviceId: 'cold-room-01',
  observedAt: '2026-09-17T10:00:20.000Z', temperatureC: 7,
  humidityPct: 66, doorState: 'CLOSED', powerState: 'ON',
};
const seed = {
  deviceId: 'cold-room-01', monitoringState: 'NORMAL',
  maxTemperatureC: 8, breachGraceSeconds: 20, recoveryGraceSeconds: 15,
  staleAfterSeconds: 20, version: 0,
};
const receivedAt = '2026-09-17T10:00:21.000Z';
const conflict = () => Object.assign(new Error('raw AWS error'), {
  name: 'ConditionalCheckFailedException',
});

function setup(device: Record<string, unknown> | undefined = seed) {
  const send = vi.fn<DocumentClient['send']>(async (command) =>
    command instanceof GetCommand ? { Item: device } : {});
  const logs: LogEntry[] = [];
  const handler = createTelemetryHandler({
    db: { send }, stage: 'dev', devicesTable: 'Devices', telemetryTable: 'Telemetry',
    incidentsTable: 'Incidents',
    now: () => new Date(receivedAt), log: (entry) => logs.push(entry),
  });
  const commands = () => send.mock.calls.map(([command]) => command);
  const updates = () => commands().filter((command) => command instanceof UpdateCommand);
  const transactions = () => commands().filter((command) => command instanceof TransactWriteCommand);
  return { handler, send, logs, commands, updates, transactions };
}

describe('telemetry handler', () => {
  it('writes the expected telemetry item with conditional deduplication, sampleKey and seven-day TTL', async () => {
    const s = setup();
    expect(await s.handler(reading)).toEqual({ result: 'updated' });
    expect(s.commands()[0]).toBeInstanceOf(PutCommand);
    expect(s.commands()[0].input).toEqual({
      TableName: 'Telemetry', ConditionExpression: 'attribute_not_exists(sampleKey)',
      Item: {
        deviceId: 'cold-room-01', eventId: 'event-01', observedAt: reading.observedAt,
        temperatureC: 7, humidityPct: 66, doorState: 'CLOSED', powerState: 'ON',
        sampleKey: `${reading.observedAt}#event-01`, receivedAt,
        ttl: Date.parse(receivedAt) / 1000 + 604800,
      },
    });
    expect(s.commands().map((command) => command.constructor.name)).toEqual([
      'PutCommand', 'GetCommand', 'UpdateCommand',
    ]);
  });

  it('rejects malformed telemetry without any DynamoDB calls or raw payload logging', async () => {
    const s = setup();
    expect(await s.handler({ ...reading, temperatureC: 'secret malformed value' }))
      .toEqual({ result: 'validation_failed' });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'telemetry_validation_failed' }));
    expect(JSON.stringify(s.logs)).not.toContain('secret malformed value');
  });

  it('returns a controlled no-op only when duplicate telemetry is already in device.latest', async () => {
    const s = setup({ ...seed, version: 1, lastProcessedAt: reading.observedAt,
      latest: { ...reading } });
    s.send.mockRejectedValueOnce(conflict());
    expect(await s.handler(reading)).toEqual({ result: 'duplicate' });
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.commands()[1]).toBeInstanceOf(GetCommand);
    expect(s.updates()).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'telemetry_duplicate', result: 'duplicate' }));
    expect(s.logs.filter((entry) => entry.operation === 'state_transition')).toHaveLength(0);
  });

  it.each(['load', 'update', 'conflicts'] as const)(
    'resumes redelivery after a partial %s failure while storing one sample and updating state once', async (failure) => {
      const s = setup();
      const samples = new Map<string, Record<string, unknown>>();
      let device: Record<string, unknown> = { ...seed, latest: { eventId: 'previous-event' } };
      let failFirstDelivery = true;
      let successfulUpdates = 0;
      s.send.mockImplementation(async (command) => {
        if (command instanceof PutCommand) {
          const item = command.input.Item!;
          const key = item.sampleKey as string;
          if (samples.has(key)) throw conflict();
          samples.set(key, item);
        } else if (command instanceof GetCommand) {
          if (failFirstDelivery && failure === 'load') throw new Error('temporary read failure');
          return { Item: { ...device } };
        } else if (command instanceof UpdateCommand) {
          if (failFirstDelivery) {
            if (failure === 'conflicts') throw conflict();
            throw new Error('temporary update failure');
          }
          const values = command.input.ExpressionAttributeValues!;
          if (device.version !== values[':expectedVersion']) throw conflict();
          device = { ...device, monitoringState: values[':state'],
            breachStartedAt: values[':breach'], recoveryStartedAt: values[':recovery'],
            lastProcessedAt: values[':processed'], latest: values[':latest'],
            version: (device.version as number) + values[':one'] };
          successfulUpdates++;
        }
        return {};
      });

      await expect(s.handler(reading)).rejects.toThrow();
      expect(samples.size).toBe(1);
      expect(device.version).toBe(0);
      failFirstDelivery = false;
      expect(await s.handler(reading)).toEqual({ result: 'updated' });
      expect(samples.size).toBe(1);
      expect(successfulUpdates).toBe(1);
      expect(device).toMatchObject({ version: 1, latest: { eventId: reading.eventId } });
      expect(s.logs).toContainEqual(expect.objectContaining({ result: 'storage_duplicate' }));
      expect(await s.handler(reading)).toEqual({ result: 'duplicate' });
      expect(successfulUpdates).toBe(1);
      expect(samples.size).toBe(1);
      expect(s.logs.filter((entry) => entry.operation === 'state_transition')).toHaveLength(1);
    },
  );

  it('returns stale for a partial-processing retry after newer telemetry has been processed', async () => {
    const s = setup({ ...seed, version: 2, latest: { eventId: 'newer-event' },
      lastProcessedAt: '2026-09-17T10:00:25.000Z' });
    s.send.mockRejectedValueOnce(conflict());
    expect(await s.handler(reading)).toEqual({ result: 'stale' });
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.updates()).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'telemetry_stale' }));
    expect(s.logs.filter((entry) => entry.operation === 'state_transition')).toHaveLength(0);
  });

  it('produces OPEN_INCIDENT once on success and none on the fully processed retry', async () => {
    const s = setup();
    s.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: {
      ...seed, monitoringState: 'WATCHING', breachStartedAt: '2026-09-17T10:00:00.000Z',
    } }).mockResolvedValueOnce({});
    const high = { ...reading, temperatureC: 9.4 };
    expect(await s.handler(high)).toEqual({ result: 'updated' });
    s.send.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: {
      ...seed, version: 1, monitoringState: 'ACTIVE', lastProcessedAt: reading.observedAt,
      breachStartedAt: '2026-09-17T10:00:00.000Z', latest: high,
      activeIncidentId: incidentIdFor(reading.deviceId, reading.eventId),
    } });
    expect(await s.handler(high)).toEqual({ result: 'duplicate' });
    expect(s.transactions()).toHaveLength(1);
    expect(s.logs.filter((entry) => entry.operation === 'state_transition')).toHaveLength(1);
    expect(s.logs.filter((entry) => entry.action === 'OPEN_INCIDENT')).toHaveLength(1);
  });

  it('detects a fully processed concurrent delivery after a version conflict', async () => {
    const s = setup();
    s.send.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: seed })
      .mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: {
        ...seed, version: 1, lastProcessedAt: reading.observedAt, latest: reading,
      } });
    expect(await s.handler(reading)).toEqual({ result: 'duplicate' });
    expect(s.updates()).toHaveLength(1);
    expect(s.commands()).toHaveLength(4);
    expect(s.logs.filter((entry) => entry.operation === 'state_transition')).toHaveLength(0);
  });

  it('handles an unknown device explicitly without creating device state', async () => {
    const s = setup();
    s.send.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    expect(await s.handler(reading)).toEqual({ result: 'device_not_found' });
    expect(s.updates()).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'device_not_found' }));
  });

  it('keeps NORMAL for a normal reading and maps absent seed windows to null', async () => {
    const s = setup();
    await s.handler(reading);
    expect(s.updates()[0].input.ExpressionAttributeValues).toMatchObject({
      ':state': 'NORMAL', ':breach': null, ':recovery': null,
    });
  });

  it('updates NORMAL to WATCHING for a high reading using configured threshold', async () => {
    const s = setup();
    await s.handler({ ...reading, temperatureC: 9.4 });
    expect(s.updates()[0].input.ExpressionAttributeValues).toMatchObject({
      ':state': 'WATCHING', ':breach': reading.observedAt, ':recovery': null,
    });
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'state_transition',
      fromState: 'NORMAL', toState: 'WATCHING', action: 'NONE' }));
  });

  it('updates WATCHING to ACTIVE at the grace boundary and persists the incident action', async () => {
    const s = setup({ ...seed, monitoringState: 'WATCHING',
      breachStartedAt: '2026-09-17T10:00:00.000Z', lastProcessedAt: '2026-09-17T10:00:15.000Z' });
    await s.handler({ ...reading, temperatureC: 9.4 });
    const transaction = s.transactions()[0].input.TransactItems!;
    expect(transaction[0].Put?.TableName).toBe('Incidents');
    expect(transaction[1].Update?.ExpressionAttributeValues?.[':state']).toBe('ACTIVE');
    expect(s.logs).toContainEqual(expect.objectContaining({ action: 'OPEN_INCIDENT', toState: 'ACTIVE' }));
    expect(s.commands()).toHaveLength(3);
  });

  it('persists stale telemetry for history without updating device state', async () => {
    const s = setup({ ...seed, lastProcessedAt: '2026-09-17T10:00:25.000Z' });
    expect(await s.handler(reading)).toEqual({ result: 'stale' });
    expect(s.commands()[0]).toBeInstanceOf(PutCommand);
    expect(s.updates()).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'telemetry_stale' }));
  });

  it('compares timestamps chronologically across accepted UTC formats', async () => {
    const s = setup({ ...seed, lastProcessedAt: '2026-09-17T10:00:20.100Z' });
    expect(await s.handler({ ...reading, observedAt: '2026-09-17T10:00:20+00:00' }))
      .toEqual({ result: 'stale' });
    expect(s.updates()).toHaveLength(0);
  });

  it('updates latest fields, observation time and receipt time and increments version conditionally', async () => {
    const s = setup({ ...seed, version: 18 });
    await s.handler(reading);
    expect(s.commands()[1].input).toMatchObject({
      TableName: 'Devices', Key: { deviceId: 'cold-room-01' }, ConsistentRead: true,
    });
    const update = s.updates()[0].input;
    expect(update.ConditionExpression).toBe('attribute_exists(deviceId) AND #version = :expectedVersion');
    expect(update.UpdateExpression).toContain('#version = #version + :one');
    expect(update.ExpressionAttributeValues).toMatchObject({
      ':expectedVersion': 18, ':one': 1, ':processed': reading.observedAt, ':seen': receivedAt,
      ':latest': { observedAt: reading.observedAt, eventId: 'event-01', temperatureC: 7,
        humidityPct: 66, doorState: 'CLOSED', powerState: 'ON' },
    });
  });

  it('keeps optional contextual fields absent in telemetry and latest', async () => {
    const s = setup();
    const { humidityPct, doorState, powerState, ...requiredOnly } = reading;
    await s.handler(requiredOnly);
    const item = (s.commands()[0] as PutCommand).input.Item;
    const latest = s.updates()[0].input.ExpressionAttributeValues?.[':latest'];
    for (const field of ['humidityPct', 'doorState', 'powerState']) {
      expect(item).not.toHaveProperty(field);
      expect(latest).not.toHaveProperty(field);
    }
  });

  it('reloads state and reevaluates after a version conflict', async () => {
    const s = setup();
    s.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: seed })
      .mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: {
        ...seed, version: 1, monitoringState: 'WATCHING',
        breachStartedAt: '2026-09-17T10:00:00.000Z',
      } }).mockResolvedValueOnce({});
    expect(await s.handler({ ...reading, temperatureC: 9 })).toEqual({ result: 'updated' });
    expect(s.updates()[0].input.ExpressionAttributeValues?.[':state']).toBe('WATCHING');
    const retryUpdate = s.transactions()[0].input.TransactItems?.[1].Update;
    expect(retryUpdate?.ExpressionAttributeValues).toMatchObject({
      ':expectedVersion': 1, ':state': 'ACTIVE',
    });
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'device_update_conflict', result: 'retrying' }));
    expect(s.logs.filter((entry) => entry.operation === 'state_transition')).toHaveLength(1);
  });

  it('does not overwrite a newer reading discovered after a conflict', async () => {
    const s = setup();
    s.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: seed })
      .mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: {
        ...seed, version: 1, lastProcessedAt: '2026-09-17T10:00:25.000Z',
      } });
    expect(await s.handler(reading)).toEqual({ result: 'stale' });
    expect(s.updates()).toHaveLength(1);
  });

  it('bounds conflicts to three update attempts and fails without an unconditional fallback', async () => {
    const s = setup();
    s.send.mockImplementation(async (command) => {
      if (command instanceof GetCommand) return { Item: seed };
      if (command instanceof UpdateCommand) throw conflict();
      return {};
    });
    await expect(s.handler(reading)).rejects.toThrow('Device state update conflict retries exhausted');
    expect(s.updates()).toHaveLength(3);
    for (const update of s.updates()) expect(update.input.ConditionExpression).toContain('#version = :expectedVersion');
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'device_update_conflict', result: 'exhausted' }));
    expect(JSON.stringify(s.logs)).not.toContain('raw AWS error');
  });

  it('fails explicitly on invalid stored configuration rather than inventing thresholds', async () => {
    const s = setup({ ...seed, maxTemperatureC: undefined });
    await expect(s.handler(reading)).rejects.toThrow('Device configuration or state could not be loaded');
    expect(s.updates()).toHaveLength(0);
  });

  it('does not misclassify a telemetry service failure as deduplication', async () => {
    const s = setup();
    s.send.mockRejectedValueOnce(new Error('raw AWS credentials or error'));
    await expect(s.handler(reading)).rejects.toThrow('Telemetry persistence failed');
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.logs)).not.toContain('raw AWS');
  });

  it('does not retry non-conditional device write failures', async () => {
    const s = setup();
    s.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: seed })
      .mockRejectedValueOnce(new Error('raw AWS exception'));
    await expect(s.handler(reading)).rejects.toThrow('Device state update failed');
    expect(s.updates()).toHaveLength(1);
    expect(JSON.stringify(s.logs)).not.toContain('raw AWS');
  });

  it('has no Bedrock reference or dependency in the service implementation', () => {
    for (const file of ['index.ts', 'lambda.ts', '../package.json']) {
      const content = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(content.toLowerCase()).not.toContain('bedrock');
    }
  });
});
