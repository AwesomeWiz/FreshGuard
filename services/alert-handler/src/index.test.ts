import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PublishCommand } from '@aws-sdk/client-sns';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createAlertHandler, type DocumentClient, type LogEntry, type SnsPublisher } from './index.js';

const openedDetail = {
  schemaVersion: 1,
  incidentId: 'inc_opened',
  deviceId: 'cold-room-01',
  openedAt: '2026-09-17T10:00:20.000Z',
  breachStartedAt: '2026-09-17T10:00:00.000Z',
  thresholdC: 8,
  breachGraceSeconds: 20,
  temperatureAtOpenC: 9.4,
  peakTemperatureC: 9.4,
  doorState: 'OPEN',
  powerState: 'ON',
} as const;

const openedEvent = {
  id: 'eventbridge-delivery-01',
  source: 'freshguard.incidents',
  'detail-type': 'freshguard.incident.opened',
  detail: openedDetail,
};

function incident(overrides: Record<string, unknown> = {}) {
  return {
    incidentId: openedDetail.incidentId,
    deviceId: openedDetail.deviceId,
    status: 'OPEN',
    openedAt: openedDetail.openedAt,
    resolvedAt: null,
    breachStartedAt: openedDetail.breachStartedAt,
    thresholdC: openedDetail.thresholdC,
    breachGraceSeconds: openedDetail.breachGraceSeconds,
    recoveryGraceSeconds: 15,
    temperatureAtOpenC: openedDetail.temperatureAtOpenC,
    latestTemperatureC: 9.4,
    peakTemperatureC: 9.4,
    doorStateAtOpen: openedDetail.doorState,
    powerStateAtOpen: openedDetail.powerState,
    notificationStatus: 'PENDING',
    notificationSentAt: null,
    ...overrides,
  };
}

function conflict() {
  return Object.assign(new Error('raw DynamoDB condition details'), {
    name: 'ConditionalCheckFailedException',
  });
}

class MemoryDb implements DocumentClient {
  item: Record<string, unknown> | undefined;
  commands: Array<GetCommand | UpdateCommand> = [];
  completeClaimBeforeConflict = false;
  failSentUpdate = false;

  constructor(item: Record<string, unknown> | undefined) {
    this.item = item ? structuredClone(item) : undefined;
  }

  async send(command: GetCommand | UpdateCommand) {
    this.commands.push(command);
    if (command instanceof GetCommand) {
      return { Item: this.item ? structuredClone(this.item) : undefined };
    }
    const values = command.input.ExpressionAttributeValues ?? {};
    if (!this.item) throw new Error('raw missing item');

    if (command.input.UpdateExpression?.includes('notificationStatus = :sending')) {
      if (this.completeClaimBeforeConflict) {
        this.completeClaimBeforeConflict = false;
        this.item.notificationStatus = 'SENDING';
        this.item.notificationClaimedAt = values[':claimedAt'];
        this.item.notificationClaimToken = 'concurrent-token';
        throw conflict();
      }
      const pendingClaim = command.input.ConditionExpression === 'notificationStatus = :pending';
      const staleClaim = command.input.ConditionExpression?.includes(':previousClaimToken');
      const conditionMatches = pendingClaim
        ? this.item.notificationStatus === 'PENDING'
        : staleClaim && this.item.notificationStatus === 'SENDING' &&
          this.item.notificationClaimedAt === values[':previousClaimedAt'] &&
          this.item.notificationClaimToken === values[':previousClaimToken'];
      if (!conditionMatches) throw conflict();
      this.item.notificationStatus = 'SENDING';
      this.item.notificationClaimedAt = values[':claimedAt'];
      this.item.notificationClaimToken = values[':claimToken'];
      return {};
    }

    if (command.input.UpdateExpression?.includes('notificationStatus = :pending')) {
      if (this.item.notificationStatus !== 'SENDING' ||
        this.item.notificationClaimToken !== values[':claimToken']) throw conflict();
      this.item.notificationStatus = 'PENDING';
      delete this.item.notificationClaimedAt;
      delete this.item.notificationClaimToken;
      return {};
    }

    if (this.failSentUpdate) throw new Error('raw DynamoDB outage');
    if (this.item.notificationStatus !== 'SENDING' ||
      this.item.notificationClaimToken !== values[':claimToken']) throw conflict();
    this.item.notificationStatus = 'SENT';
    this.item.notificationSentAt = values[':sentAt'];
    delete this.item.notificationClaimedAt;
    delete this.item.notificationClaimToken;
    return {};
  }
}

class MemorySns implements SnsPublisher {
  commands: PublishCommand[] = [];
  responses: Array<{ MessageId?: string } | Error> = [];

  async send(command: PublishCommand) {
    this.commands.push(command);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response ?? { MessageId: `message-${this.commands.length}` };
  }
}

function setup(item: Record<string, unknown> | null = incident()) {
  const db = new MemoryDb(item ?? undefined);
  const sns = new MemorySns();
  const logs: LogEntry[] = [];
  let tokenNumber = 0;
  const handler = createAlertHandler({
    db,
    sns,
    stage: 'dev',
    incidentsTable: 'Incidents',
    alertTopicArn: 'arn:aws:sns:ap-south-1:123456789012:freshguard-dev-incident-alerts',
    claimLeaseSeconds: 60,
    now: () => new Date('2026-09-17T10:05:00.000Z'),
    claimToken: () => `claim-${++tokenNumber}`,
    log: (entry) => logs.push(entry),
  });
  return { db, sns, logs, handler };
}

describe('alert handler', () => {
  it('loads a valid opened incident, claims it and publishes a concise persisted-evidence alert', async () => {
    const s = setup();
    expect(await s.handler(openedEvent)).toEqual({ result: 'sent' });
    expect(s.db.commands[0]).toBeInstanceOf(GetCommand);
    expect(s.db.commands[0].input).toMatchObject({
      TableName: 'Incidents', Key: { incidentId: 'inc_opened' }, ConsistentRead: true,
    });
    expect(s.sns.commands).toHaveLength(1);
    expect(s.sns.commands[0].input.Subject).toBe('FreshGuard incident: cold-room-01');
    expect(s.sns.commands[0].input.TopicArn)
      .toBe('arn:aws:sns:ap-south-1:123456789012:freshguard-dev-incident-alerts');
    const message = s.sns.commands[0].input.Message ?? '';
    for (const expected of [
      'Incident ID: inc_opened',
      'Device ID: cold-room-01',
      'Opened at: 2026-09-17T10:00:20.000Z',
      'Opening temperature: 9.4 C',
      'Configured threshold: 8 C',
      'Door observation: OPEN',
      'Power observation: ON',
    ]) expect(message).toContain(expected);
    expect(message.toLowerCase()).not.toContain('unsafe');
    expect(message.toLowerCase()).not.toContain('spoilage');
  });

  it('ignores events other than freshguard.incident.opened', async () => {
    const s = setup();
    expect(await s.handler({ ...openedEvent, 'detail-type': 'freshguard.incident.resolved' }))
      .toEqual({ result: 'ignored' });
    expect(s.db.commands).toHaveLength(0);
    expect(s.sns.commands).toHaveLength(0);
  });

  it('returns already_sent without publishing when notificationStatus is SENT', async () => {
    const s = setup(incident({ notificationStatus: 'SENT',
      notificationSentAt: '2026-09-17T10:01:00.000Z' }));
    expect(await s.handler(openedEvent)).toEqual({ result: 'already_sent' });
    expect(s.sns.commands).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'alert_already_sent', incidentId: 'inc_opened', result: 'already_sent',
    }));
  });

  it('records SENT and notificationSentAt after SNS accepts the alert', async () => {
    const s = setup();
    await s.handler(openedEvent);
    expect(s.db.item).toMatchObject({
      notificationStatus: 'SENT',
      notificationSentAt: '2026-09-17T10:05:00.000Z',
    });
    expect(s.db.item).not.toHaveProperty('notificationClaimedAt');
    expect(s.db.item).not.toHaveProperty('notificationClaimToken');
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'alert_claimed', notificationStatus: 'SENDING', result: 'claimed',
    }));
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'alert_sent', notificationStatus: 'SENT', result: 'sent',
    }));
  });

  it('handles a conditional claim conflict as retryable controlled concurrency', async () => {
    const s = setup();
    s.db.completeClaimBeforeConflict = true;
    await expect(s.handler(openedEvent)).rejects.toThrow('currently claimed');
    expect(s.sns.commands).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'alert_failed', result: 'claim_in_progress',
    }));
    expect(JSON.stringify(s.logs)).not.toContain('raw DynamoDB');
  });

  it('lets only one of two concurrent duplicate deliveries publish normally', async () => {
    const s = setup();
    const results = await Promise.allSettled([
      s.handler(openedEvent),
      s.handler({ ...openedEvent, id: 'eventbridge-delivery-02' }),
    ]);
    expect(results.some((result) => result.status === 'fulfilled' &&
      result.value.result === 'sent')).toBe(true);
    expect(s.sns.commands).toHaveLength(1);
    expect(s.db.item?.notificationStatus).toBe('SENT');
  });

  it('reclaims a stale SENDING lease and sends the alert', async () => {
    const s = setup(incident({
      notificationStatus: 'SENDING',
      notificationClaimedAt: '2026-09-17T10:03:00.000Z',
      notificationClaimToken: 'abandoned-claim',
    }));
    expect(await s.handler(openedEvent)).toEqual({ result: 'sent' });
    expect(s.sns.commands).toHaveLength(1);
    expect(s.db.item?.notificationStatus).toBe('SENT');
  });

  it('fails a fresh SENDING lease so EventBridge retries instead of losing a stuck claim', async () => {
    const s = setup(incident({
      notificationStatus: 'SENDING',
      notificationClaimedAt: '2026-09-17T10:04:30.000Z',
      notificationClaimToken: 'active-claim',
    }));
    await expect(s.handler(openedEvent)).rejects.toThrow('currently claimed');
    expect(s.sns.commands).toHaveLength(0);
  });

  it('releases a failed SNS claim to PENDING and succeeds on retry', async () => {
    const s = setup();
    s.sns.responses.push(new Error('raw SNS error'));
    await expect(s.handler(openedEvent)).rejects.toThrow('publish failed');
    expect(s.db.item).toMatchObject({ notificationStatus: 'PENDING' });
    expect(s.db.item).not.toHaveProperty('notificationClaimToken');
    expect(JSON.stringify(s.logs)).not.toContain('raw SNS');

    expect(await s.handler(openedEvent)).toEqual({ result: 'sent' });
    expect(s.sns.commands).toHaveLength(2);
    expect(s.db.item?.notificationStatus).toBe('SENT');
  });

  it('keeps a successful SNS publish retryable when persisting SENT fails', async () => {
    const s = setup();
    s.db.failSentUpdate = true;
    await expect(s.handler(openedEvent)).rejects.toThrow('status update failed');
    expect(s.sns.commands).toHaveLength(1);
    expect(s.db.item).toMatchObject({ notificationStatus: 'SENDING' });
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'alert_failed', result: 'status_update_failed',
    }));
  });

  it('fails safely without publishing when the incident is missing', async () => {
    const s = setup(null);
    await expect(s.handler(openedEvent)).rejects.toThrow('could not be verified');
    expect(s.sns.commands).toHaveLength(0);
    expect(s.logs).toContainEqual(expect.objectContaining({
      operation: 'alert_failed', result: 'incident_load_failed',
    }));
  });

  it('fails safely on malformed opened-event detail', async () => {
    const s = setup();
    await expect(s.handler({ ...openedEvent,
      detail: { ...openedDetail, temperatureAtOpenC: 'not-a-number' } }))
      .rejects.toThrow('validation failed');
    expect(s.db.commands).toHaveLength(0);
    expect(s.sns.commands).toHaveLength(0);
  });

  it('fails before publishing when event evidence disagrees with the incident', async () => {
    const s = setup();
    await expect(s.handler({ ...openedEvent,
      detail: { ...openedDetail, thresholdC: 7 } }))
      .rejects.toThrow('could not be verified');
    expect(s.sns.commands).toHaveLength(0);
  });

  it('still sends an unsent opening notification after the incident is RESOLVED', async () => {
    const s = setup(incident({
      status: 'RESOLVED',
      resolvedAt: '2026-09-17T10:10:00.000Z',
      durationSeconds: 580,
    }));
    expect(await s.handler(openedEvent)).toEqual({ result: 'sent' });
    expect(s.sns.commands).toHaveLength(1);
  });

  it('has no Bedrock or telemetry-handler dependency', () => {
    for (const file of ['index.ts', 'lambda.ts', '../package.json']) {
      const content = readFileSync(new URL(file, import.meta.url), 'utf8').toLowerCase();
      expect(content).not.toContain('bedrock');
      expect(content).not.toContain('@freshguard/telemetry-handler');
    }
  });
});
