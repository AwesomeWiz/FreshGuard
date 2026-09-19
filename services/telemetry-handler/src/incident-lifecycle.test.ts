import { describe, expect, it } from 'vitest';
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createTelemetryHandler, incidentIdFor, type DocumentClient, type LogEntry } from './index.js';

const baseReading = {
  schemaVersion: 1,
  eventId: 'event-open',
  deviceId: 'cold-room-01',
  observedAt: '2026-09-17T10:00:20.000Z',
  temperatureC: 9.4,
  humidityPct: 66,
  doorState: 'OPEN',
  powerState: 'ON',
} as const;

const seed = {
  deviceId: 'cold-room-01',
  monitoringState: 'NORMAL',
  maxTemperatureC: 8,
  breachGraceSeconds: 20,
  recoveryGraceSeconds: 15,
  staleAfterSeconds: 20,
  breachStartedAt: null,
  recoveryStartedAt: null,
  lastProcessedAt: null,
  version: 0,
};

function conflict(name = 'TransactionCanceledException') {
  return Object.assign(new Error('raw DynamoDB cancellation'), { name });
}

class MemoryDb implements DocumentClient {
  device: Record<string, unknown> | undefined;
  incidents = new Map<string, Record<string, unknown>>();
  samples = new Set<string>();
  commands: Parameters<DocumentClient['send']>[0][] = [];
  transactionAttempts = 0;
  failTransactions = 0;
  completeConflictingTransaction = false;

  constructor(device: Record<string, unknown> | undefined) {
    this.device = device ? structuredClone(device) : undefined;
  }

  async send(command: Parameters<DocumentClient['send']>[0]) {
    this.commands.push(command);
    if (command instanceof PutCommand) {
      const key = String(command.input.Item?.sampleKey);
      if (this.samples.has(key)) throw conflict('ConditionalCheckFailedException');
      this.samples.add(key);
      return {};
    }
    if (command instanceof GetCommand) {
      if (command.input.TableName === 'Devices') {
        return { Item: this.device ? structuredClone(this.device) : undefined };
      }
      const incidentId = String(command.input.Key?.incidentId);
      const incident = this.incidents.get(incidentId);
      return { Item: incident ? structuredClone(incident) : undefined };
    }
    if (command instanceof UpdateCommand) {
      this.applyDeviceUpdate(command.input);
      return {};
    }
    if (command instanceof TransactWriteCommand) {
      this.transactionAttempts++;
      if (this.failTransactions > 0) {
        this.failTransactions--;
        throw conflict();
      }
      if (this.completeConflictingTransaction) {
        this.completeConflictingTransaction = false;
        this.applyTransaction(command);
        throw conflict();
      }
      this.applyTransaction(command);
      return {};
    }
    return {};
  }

  private validateDeviceUpdate(input: {
    ConditionExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
  }) {
    const values = input.ExpressionAttributeValues ?? {};
    if (!this.device || this.device.version !== values[':expectedVersion']) throw conflict();
    if (input.ConditionExpression?.includes('attribute_not_exists(activeIncidentId)') &&
      this.device.activeIncidentId !== undefined) throw conflict();
    if (input.ConditionExpression?.includes('activeIncidentId = :incidentId') &&
      this.device.activeIncidentId !== values[':incidentId']) throw conflict();
  }

  private applyDeviceUpdate(input: {
    UpdateExpression?: string;
    ConditionExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
  }) {
    this.validateDeviceUpdate(input);
    const values = input.ExpressionAttributeValues ?? {};
    this.device = {
      ...this.device,
      monitoringState: values[':state'],
      breachStartedAt: values[':breach'],
      recoveryStartedAt: values[':recovery'],
      lastProcessedAt: values[':processed'],
      lastSeenAt: values[':seen'],
      latest: values[':latest'],
      version: Number(this.device?.version) + Number(values[':one']),
    };
    if (input.UpdateExpression?.includes('activeIncidentId = :incidentId')) {
      this.device.activeIncidentId = values[':incidentId'];
    }
    if (input.UpdateExpression?.includes('REMOVE activeIncidentId')) {
      delete this.device.activeIncidentId;
    }
  }

  private applyTransaction(command: TransactWriteCommand) {
    const items = command.input.TransactItems ?? [];
    for (const item of items) {
      if (item.Put) {
        const id = String(item.Put.Item?.incidentId);
        if (this.incidents.has(id)) throw conflict();
      }
      if (item.Update?.TableName === 'Devices') this.validateDeviceUpdate(item.Update);
      if (item.Update?.TableName === 'Incidents') {
        const id = String(item.Update.Key?.incidentId);
        const incident = this.incidents.get(id);
        if (incident?.status !== 'OPEN' ||
          incident.deviceId !== item.Update.ExpressionAttributeValues?.[':deviceId']) throw conflict();
      }
    }
    for (const item of items) {
      if (item.Put) {
        const incident = structuredClone(item.Put.Item as Record<string, unknown>);
        this.incidents.set(String(incident.incidentId), incident);
      } else if (item.Update?.TableName === 'Devices') {
        this.applyDeviceUpdate(item.Update);
      } else if (item.Update?.TableName === 'Incidents') {
        const values = item.Update.ExpressionAttributeValues ?? {};
        const id = String(item.Update.Key?.incidentId);
        const current = this.incidents.get(id)!;
        if (item.Update.UpdateExpression?.includes('latestTemperatureC')) {
          current.latestTemperatureC = values[':temperature'];
          current.peakTemperatureC = values[':peak'];
        } else {
          current.status = values[':resolved'];
          current.resolvedAt = values[':resolvedAt'];
          current.durationSeconds = values[':duration'];
        }
      }
    }
  }
}

function setup(device: Record<string, unknown>) {
  const db = new MemoryDb(device);
  const logs: LogEntry[] = [];
  const handler = createTelemetryHandler({
    db,
    stage: 'dev',
    devicesTable: 'Devices',
    telemetryTable: 'Telemetry',
    incidentsTable: 'Incidents',
    now: () => new Date('2026-09-17T10:10:00.000Z'),
    log: (entry) => logs.push(entry),
  });
  return { db, logs, handler };
}

function watching() {
  return {
    ...seed,
    monitoringState: 'WATCHING',
    breachStartedAt: '2026-09-17T10:00:00.000Z',
    lastProcessedAt: '2026-09-17T10:00:10.000Z',
    version: 4,
  };
}

function openIncident(incidentId = 'inc_existing') {
  return {
    incidentId,
    deviceId: seed.deviceId,
    status: 'OPEN',
    openedAt: '2026-09-17T10:00:20.000Z',
    resolvedAt: null,
    breachStartedAt: '2026-09-17T10:00:00.000Z',
    thresholdC: 8,
    breachGraceSeconds: 20,
    recoveryGraceSeconds: 15,
    temperatureAtOpenC: 9.4,
    latestTemperatureC: 9.4,
    peakTemperatureC: 9.4,
    doorStateAtOpen: 'OPEN',
    powerStateAtOpen: 'ON',
    notificationStatus: 'PENDING',
    notificationSentAt: null,
    aiStatus: 'PENDING',
    aiExplanation: null,
    durationSeconds: null,
    eventDispatchStatus: 'PENDING',
  };
}

function active(incidentId = 'inc_existing') {
  return {
    ...seed,
    monitoringState: 'ACTIVE',
    activeIncidentId: incidentId,
    breachStartedAt: '2026-09-17T10:00:00.000Z',
    lastProcessedAt: '2026-09-17T10:00:20.000Z',
    version: 5,
  };
}

describe('incident lifecycle persistence', () => {
  it('atomically opens one incident with immutable evidence and stores activeIncidentId', async () => {
    const s = setup(watching());
    expect(await s.handler(baseReading)).toEqual({ result: 'updated' });

    const incidentId = incidentIdFor(baseReading.deviceId, baseReading.eventId);
    expect(incidentId).toMatch(/^inc_[A-Za-z0-9_-]+$/);
    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.incidents.get(incidentId)).toEqual({
      incidentId,
      deviceId: baseReading.deviceId,
      status: 'OPEN',
      openedAt: baseReading.observedAt,
      resolvedAt: null,
      breachStartedAt: '2026-09-17T10:00:00.000Z',
      thresholdC: 8,
      breachGraceSeconds: 20,
      recoveryGraceSeconds: 15,
      temperatureAtOpenC: 9.4,
      latestTemperatureC: 9.4,
      peakTemperatureC: 9.4,
      doorStateAtOpen: 'OPEN',
      powerStateAtOpen: 'ON',
      notificationStatus: 'PENDING',
      notificationSentAt: null,
      aiStatus: 'PENDING',
      aiExplanation: null,
      durationSeconds: null,
      eventDispatchStatus: 'PENDING',
    });
    expect(s.db.device).toMatchObject({
      monitoringState: 'ACTIVE', activeIncidentId: incidentId,
      lastProcessedAt: baseReading.observedAt, version: 5,
    });
    const transaction = s.db.commands.find((command) => command instanceof TransactWriteCommand);
    expect(transaction?.input.TransactItems?.[0].Put?.ConditionExpression)
      .toBe('attribute_not_exists(incidentId)');
    expect(transaction?.input.TransactItems?.[1].Update?.ConditionExpression)
      .toContain('attribute_not_exists(activeIncidentId)');
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'incident_opened', incidentId, fromState: 'WATCHING', toState: 'ACTIVE',
    }));
  });

  it('uses UNKNOWN opening context when optional signals are absent', async () => {
    const s = setup(watching());
    const { humidityPct, doorState, powerState, ...required } = baseReading;
    await s.handler(required);
    const incident = [...s.db.incidents.values()][0];
    expect(incident).toMatchObject({ doorStateAtOpen: 'UNKNOWN', powerStateAtOpen: 'UNKNOWN' });
  });

  it('updates the same active incident and keeps peak monotonic and opening evidence immutable', async () => {
    const s = setup(active());
    const original = openIncident();
    s.db.incidents.set('inc_existing', structuredClone(original));

    await s.handler({ ...baseReading, eventId: 'event-hotter', observedAt: '2026-09-17T10:00:25.000Z', temperatureC: 10.2 });
    await s.handler({ ...baseReading, eventId: 'event-lower', observedAt: '2026-09-17T10:00:30.000Z', temperatureC: 9.1 });

    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.incidents.get('inc_existing')).toMatchObject({
      ...original,
      latestTemperatureC: 9.1,
      peakTemperatureC: 10.2,
    });
    expect(s.db.device).toMatchObject({ monitoringState: 'ACTIVE', activeIncidentId: 'inc_existing' });
    expect(s.logs.filter((entry) => entry.operation === 'incident_updated')).toHaveLength(2);
  });

  it('makes an exact ACTIVE update retry a duplicate without mutating the incident twice', async () => {
    const s = setup(active());
    s.db.incidents.set('inc_existing', openIncident());
    const update = { ...baseReading, eventId: 'event-active-retry',
      observedAt: '2026-09-17T10:00:25.000Z', temperatureC: 10.2 };
    expect(await s.handler(update)).toEqual({ result: 'updated' });
    expect(await s.handler(update)).toEqual({ result: 'duplicate' });
    expect(s.db.transactionAttempts).toBe(1);
    expect(s.db.incidents.get('inc_existing')).toMatchObject({
      latestTemperatureC: 10.2, peakTemperatureC: 10.2,
    });
  });

  it('rejects a device pointer in WATCHING instead of opening a second incident', async () => {
    const s = setup({ ...watching(), activeIncidentId: 'inc_existing' });
    s.db.incidents.set('inc_existing', openIncident());
    await expect(s.handler(baseReading)).rejects.toThrow('Incident lifecycle invariant violated');
    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.transactionAttempts).toBe(0);
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'incident_invariant_failed' }));
  });

  it('treats an exact opening retry as a duplicate without a second transaction', async () => {
    const s = setup(watching());
    expect(await s.handler(baseReading)).toEqual({ result: 'updated' });
    expect(await s.handler(baseReading)).toEqual({ result: 'duplicate' });
    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.transactionAttempts).toBe(1);
  });

  it('retries an opening transaction that failed atomically before completion', async () => {
    const s = setup(watching());
    s.db.failTransactions = 1;
    expect(await s.handler(baseReading)).toEqual({ result: 'updated' });
    expect(s.db.transactionAttempts).toBe(2);
    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.device).toMatchObject({ monitoringState: 'ACTIVE', version: 5 });
  });

  it('reconciles an opening race when another invocation completed the transaction', async () => {
    const s = setup(watching());
    s.db.completeConflictingTransaction = true;
    expect(await s.handler(baseReading)).toEqual({ result: 'duplicate' });
    expect(s.db.transactionAttempts).toBe(1);
    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.device).toMatchObject({
      activeIncidentId: incidentIdFor(baseReading.deviceId, baseReading.eventId),
      version: 5,
    });
  });

  it('enters RECOVERING without resolving or replacing the incident', async () => {
    const s = setup(active());
    s.db.incidents.set('inc_existing', openIncident());
    const recovery = { ...baseReading, eventId: 'event-recovery',
      observedAt: '2026-09-17T10:00:30.000Z', temperatureC: 7.5 };
    expect(await s.handler(recovery)).toEqual({ result: 'updated' });
    expect(s.db.device).toMatchObject({
      monitoringState: 'RECOVERING', activeIncidentId: 'inc_existing',
      recoveryStartedAt: recovery.observedAt,
    });
    expect(s.db.incidents.get('inc_existing')?.status).toBe('OPEN');
    expect(s.db.transactionAttempts).toBe(0);
  });

  it('rebounds from RECOVERING to ACTIVE with the same incident', async () => {
    const s = setup({ ...active(), monitoringState: 'RECOVERING',
      recoveryStartedAt: '2026-09-17T10:00:30.000Z',
      lastProcessedAt: '2026-09-17T10:00:30.000Z' });
    s.db.incidents.set('inc_existing', openIncident());
    expect(await s.handler({ ...baseReading, eventId: 'event-rebound',
      observedAt: '2026-09-17T10:00:35.000Z', temperatureC: 9.8 }))
      .toEqual({ result: 'updated' });
    expect(s.db.device).toMatchObject({
      monitoringState: 'ACTIVE', activeIncidentId: 'inc_existing', recoveryStartedAt: null,
    });
    expect(s.db.incidents.get('inc_existing')).toMatchObject({
      status: 'OPEN', latestTemperatureC: 9.8, peakTemperatureC: 9.8,
    });
  });

  it('atomically resolves the same incident, calculates duration and clears activeIncidentId', async () => {
    const s = setup({ ...active(), monitoringState: 'RECOVERING',
      recoveryStartedAt: '2026-09-17T10:00:30.000Z',
      lastProcessedAt: '2026-09-17T10:00:35.000Z' });
    s.db.incidents.set('inc_existing', openIncident());
    const resolved = { ...baseReading, eventId: 'event-resolved',
      observedAt: '2026-09-17T10:00:45.000Z', temperatureC: 7.2 };
    expect(await s.handler(resolved)).toEqual({ result: 'updated' });
    expect(s.db.incidents.get('inc_existing')).toMatchObject({
      status: 'RESOLVED', resolvedAt: resolved.observedAt, durationSeconds: 25,
      peakTemperatureC: 9.4, temperatureAtOpenC: 9.4,
    });
    expect(s.db.device).toMatchObject({
      monitoringState: 'NORMAL', breachStartedAt: null, recoveryStartedAt: null,
      lastProcessedAt: resolved.observedAt,
    });
    expect(s.db.device).not.toHaveProperty('activeIncidentId');
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'incident_resolved', incidentId: 'inc_existing',
      fromState: 'RECOVERING', toState: 'NORMAL',
    }));
  });

  it('makes a successful resolution retry a controlled duplicate', async () => {
    const s = setup({ ...active(), monitoringState: 'RECOVERING',
      recoveryStartedAt: '2026-09-17T10:00:30.000Z',
      lastProcessedAt: '2026-09-17T10:00:35.000Z' });
    s.db.incidents.set('inc_existing', openIncident());
    const resolved = { ...baseReading, eventId: 'event-resolved',
      observedAt: '2026-09-17T10:00:45.000Z', temperatureC: 7.2 };
    expect(await s.handler(resolved)).toEqual({ result: 'updated' });
    expect(await s.handler(resolved)).toEqual({ result: 'duplicate' });
    expect(s.db.transactionAttempts).toBe(1);
    expect(s.db.incidents.get('inc_existing')?.status).toBe('RESOLVED');
  });

  it('never reopens a resolved incident during a later excursion', async () => {
    const s = setup({ ...seed, version: 8,
      lastProcessedAt: '2026-09-17T10:00:45.000Z' });
    const old = { ...openIncident(), status: 'RESOLVED',
      resolvedAt: '2026-09-17T10:00:45.000Z', durationSeconds: 25 };
    s.db.incidents.set('inc_existing', old);
    await s.handler({ ...baseReading, eventId: 'new-breach',
      observedAt: '2026-09-17T10:01:00.000Z' });
    await s.handler({ ...baseReading, eventId: 'new-open',
      observedAt: '2026-09-17T10:01:20.000Z' });
    expect(s.db.incidents.get('inc_existing')).toEqual(old);
    expect(s.db.incidents).toHaveLength(2);
    expect(s.db.device?.activeIncidentId).toBe(incidentIdFor(seed.deviceId, 'new-open'));
  });

  it('does not let out-of-order telemetry mutate an active incident', async () => {
    const s = setup(active());
    const incident = openIncident();
    s.db.incidents.set('inc_existing', structuredClone(incident));
    expect(await s.handler({ ...baseReading, eventId: 'older',
      observedAt: '2026-09-17T10:00:19.000Z', temperatureC: 12 }))
      .toEqual({ result: 'stale' });
    expect(s.db.incidents.get('inc_existing')).toEqual(incident);
    expect(s.db.transactionAttempts).toBe(0);
  });

  it('does not let out-of-order telemetry reopen after resolution', async () => {
    const s = setup({ ...seed, version: 9,
      lastProcessedAt: '2026-09-17T10:00:45.000Z' });
    const resolved = { ...openIncident(), status: 'RESOLVED',
      resolvedAt: '2026-09-17T10:00:45.000Z', durationSeconds: 25 };
    s.db.incidents.set('inc_existing', structuredClone(resolved));
    expect(await s.handler({ ...baseReading, eventId: 'older',
      observedAt: '2026-09-17T10:00:25.000Z', temperatureC: 12 }))
      .toEqual({ result: 'stale' });
    expect(s.db.incidents).toHaveLength(1);
    expect(s.db.incidents.get('inc_existing')).toEqual(resolved);
  });
});
