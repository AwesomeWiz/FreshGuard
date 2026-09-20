import { describe, expect, it } from 'vitest';
import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  createReadApiHandler,
  mapPresentationState,
  type ApiEvent,
  type DocumentClient,
} from './index.js';

type Command = GetCommand | QueryCommand | ScanCommand;

class MemoryDb implements DocumentClient {
  commands: Command[] = [];
  replies: Array<{ Item?: Record<string, unknown>; Items?: Record<string, unknown>[] } | Error>;

  constructor(...replies: MemoryDb['replies']) {
    this.replies = replies;
  }

  async send(command: Command) {
    this.commands.push(command);
    const reply = this.replies.shift() ?? {};
    if (reply instanceof Error) throw reply;
    return structuredClone(reply);
  }
}

const latest = {
  eventId: 'evt-1',
  observedAt: '2026-09-17T10:00:00.000Z',
  temperatureC: 9.4,
  humidityPct: 66,
  doorState: 'OPEN',
  powerState: 'ON',
};

function device(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'cold-room-01',
    displayName: 'Cold Room 01',
    monitoringState: 'ACTIVE',
    maxTemperatureC: 8,
    breachGraceSeconds: 20,
    recoveryGraceSeconds: 15,
    staleAfterSeconds: 20,
    lastSeenAt: latest.observedAt,
    latest,
    activeIncidentId: 'inc_1',
    version: 7,
    latestLifecycleIncidentId: 'inc_1',
    latestLifecycleEventId: 'evt-1',
    latestLifecycleEventType: 'OPENED',
    ...overrides,
  };
}

function incident(overrides: Record<string, unknown> = {}) {
  return {
    incidentId: 'inc_1',
    deviceId: 'cold-room-01',
    status: 'RESOLVED',
    openedAt: '2026-09-17T10:00:00.000Z',
    resolvedAt: '2026-09-17T10:03:00.000Z',
    breachStartedAt: '2026-09-17T09:59:40.000Z',
    thresholdC: 8,
    breachGraceSeconds: 20,
    recoveryGraceSeconds: 15,
    temperatureAtOpenC: 9.2,
    latestTemperatureC: 7.1,
    peakTemperatureC: 10.4,
    doorStateAtOpen: 'OPEN',
    powerStateAtOpen: 'ON',
    notificationStatus: 'SENT',
    notificationSentAt: '2026-09-17T10:00:01.000Z',
    aiStatus: 'PENDING',
    aiExplanation: null,
    durationSeconds: 180,
    openedEventDispatchStatus: 'SENT',
    resolvedEventDispatchStatus: 'SENT',
    eventDispatchStatus: 'SENT',
    notificationClaimToken: 'secret-claim',
    notificationClaimedAt: '2026-09-17T10:00:00.500Z',
    ...overrides,
  };
}

function event(path: string, options: {
  method?: string;
  query?: Record<string, string>;
  origin?: string;
  requestId?: string;
} = {}): ApiEvent {
  return {
    rawPath: path,
    headers: options.origin ? { origin: options.origin } : {},
    queryStringParameters: options.query,
    requestContext: {
      requestId: options.requestId ?? 'request-123',
      stage: 'dev',
      http: { method: options.method ?? 'GET', path },
    },
  };
}

function setup(db: MemoryDb, allowedOrigins?: string[]) {
  return createReadApiHandler({
    db,
    stage: 'dev',
    devicesTable: 'devices',
    telemetryTable: 'telemetry',
    incidentsTable: 'incidents',
    incidentsByDeviceIndex: 'ByDeviceOpenedAt',
    allowedOrigins,
    now: () => new Date('2026-09-17T10:30:00.000Z'),
    log: () => undefined,
  });
}

function body(response: { body: string }) {
  return JSON.parse(response.body) as Record<string, any>;
}

describe('FreshGuard read API', () => {
  it('returns the exact documented health payload without DynamoDB', async () => {
    const db = new MemoryDb();
    const response = await setup(db)(event('/health'));
    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual({ status: 'ok', service: 'freshguard-api' });
    expect(db.commands).toHaveLength(0);
  });

  it('maps devices to compact list DTOs', async () => {
    const db = new MemoryDb({ Items: [device()] });
    const response = await setup(db)(event('/devices'));
    expect(db.commands[0]).toBeInstanceOf(ScanCommand);
    expect(body(response)).toEqual({ items: [{
      deviceId: 'cold-room-01', displayName: 'Cold Room 01', monitoringState: 'ACTIVE',
      lastSeenAt: latest.observedAt, latestTemperatureC: 9.4,
    }] });
  });

  it('keeps the device scan bounded', async () => {
    const db = new MemoryDb({ Items: [] });
    await setup(db)(event('/devices'));
    expect((db.commands[0] as ScanCommand).input.Limit).toBe(50);
  });

  it('maps device configuration and latest telemetry', async () => {
    const response = await setup(new MemoryDb({ Item: device() }))(event('/devices/cold-room-01'));
    expect(body(response)).toMatchObject({
      deviceId: 'cold-room-01',
      configuration: { maxTemperatureC: 8, breachGraceSeconds: 20, recoveryGraceSeconds: 15, staleAfterSeconds: 20 },
      latest: { observedAt: latest.observedAt, temperatureC: 9.4, humidityPct: 66, doorState: 'OPEN', powerState: 'ON' },
      activeIncidentId: 'inc_1',
    });
  });

  it('maps ACTIVE to INCIDENT', () => expect(mapPresentationState('ACTIVE')).toBe('INCIDENT'));
  it('maps NORMAL to HEALTHY', () => expect(mapPresentationState('NORMAL')).toBe('HEALTHY'));
  it('maps WATCHING to WATCHING', () => expect(mapPresentationState('WATCHING')).toBe('WATCHING'));
  it('maps RECOVERING to RECOVERING', () => expect(mapPresentationState('RECOVERING')).toBe('RECOVERING'));

  it('does not expose internal Device reliability fields', async () => {
    const response = await setup(new MemoryDb({ Item: device() }))(event('/devices/cold-room-01'));
    expect(response.body).not.toContain('version');
    expect(response.body).not.toContain('latestLifecycle');
    expect(response.body).not.toContain('eventId');
  });

  it('maps an absent latest reading safely', async () => {
    const stored = device({ monitoringState: 'NORMAL', latest: undefined, activeIncidentId: null, lastSeenAt: undefined });
    const response = await setup(new MemoryDb({ Item: stored }))(event('/devices/cold-room-01'));
    expect(body(response)).toMatchObject({ latest: null, activeIncidentId: null, presentationState: 'HEALTHY' });
  });

  it('returns a safe DEVICE_NOT_FOUND response with requestId', async () => {
    const response = await setup(new MemoryDb({}))(event('/devices/cold-room-01'));
    expect(response.statusCode).toBe(404);
    expect(body(response)).toEqual({ error: { code: 'DEVICE_NOT_FOUND', message: 'Device was not found', requestId: 'request-123' } });
  });

  it('rejects invalid bounded path identifiers before reading DynamoDB', async () => {
    const db = new MemoryDb();
    const response = await setup(db)(event(`/devices/${'a'.repeat(65)}`));
    expect(response.statusCode).toBe(400);
    expect(body(response).error.code).toBe('INVALID_QUERY');
    expect(db.commands).toHaveLength(0);
  });

  it('uses DynamoDB Query for telemetry', async () => {
    const db = new MemoryDb({ Item: device() }, { Items: [] });
    await setup(db)(event('/devices/cold-room-01/telemetry'));
    expect(db.commands[0]).toBeInstanceOf(GetCommand);
    expect(db.commands[1]).toBeInstanceOf(QueryCommand);
    expect((db.commands[1] as QueryCommand).input.TableName).toBe('telemetry');
  });

  it('derives the telemetry start range from minutes', async () => {
    const db = new MemoryDb({ Item: device() }, { Items: [] });
    await setup(db)(event('/devices/cold-room-01/telemetry', { query: { minutes: '60' } }));
    expect((db.commands[1] as QueryCommand).input.ExpressionAttributeValues?.[':startKey'])
      .toBe('2026-09-17T09:30:00.000Z#');
  });

  it('defaults telemetry minutes to 30', async () => {
    const db = new MemoryDb({ Item: device() }, { Items: [] });
    await setup(db)(event('/devices/cold-room-01/telemetry'));
    expect((db.commands[1] as QueryCommand).input.ExpressionAttributeValues?.[':startKey'])
      .toBe('2026-09-17T10:00:00.000Z#');
  });

  it('defaults telemetry limit to 300', async () => {
    const db = new MemoryDb({ Item: device() }, { Items: [] });
    await setup(db)(event('/devices/cold-room-01/telemetry'));
    expect((db.commands[1] as QueryCommand).input.Limit).toBe(300);
  });

  it('rejects a telemetry limit above 300', async () => {
    const db = new MemoryDb();
    const response = await setup(db)(event('/devices/cold-room-01/telemetry', { query: { limit: '301' } }));
    expect(response.statusCode).toBe(400);
    expect(body(response).error.code).toBe('INVALID_QUERY');
    expect(db.commands).toHaveLength(0);
  });

  it.each([
    ['minutes', '0'], ['minutes', '-1'], ['minutes', '1.5'], ['minutes', '1441'],
    ['limit', 'nope'], ['limit', '0'],
  ])('rejects invalid telemetry %s=%s safely', async (name, value) => {
    const response = await setup(new MemoryDb())(event('/devices/cold-room-01/telemetry', { query: { [name]: value } }));
    expect(response.statusCode).toBe(400);
    expect(body(response).error.code).toBe('INVALID_QUERY');
  });

  it('returns telemetry chronologically without storage metadata', async () => {
    const newer = { ...latest, observedAt: '2026-09-17T10:02:00.000Z', sampleKey: 'new', ttl: 123, receivedAt: 'x' };
    const older = { ...latest, observedAt: '2026-09-17T10:01:00.000Z', sampleKey: 'old', ttl: 122, receivedAt: 'x' };
    const response = await setup(new MemoryDb({ Item: device() }, { Items: [newer, older] }))
      (event('/devices/cold-room-01/telemetry'));
    const parsed = body(response);
    expect(parsed.items.map((item: any) => item.observedAt)).toEqual([older.observedAt, newer.observedAt]);
    expect(response.body).not.toContain('sampleKey');
    expect(response.body).not.toContain('ttl');
    expect(response.body).not.toContain('receivedAt');
    expect(response.body).not.toContain('eventId');
  });

  it('uses ByDeviceOpenedAt for incident history', async () => {
    const db = new MemoryDb({ Item: device() }, { Items: [] });
    await setup(db)(event('/devices/cold-room-01/incidents'));
    const query = db.commands[1] as QueryCommand;
    expect(query).toBeInstanceOf(QueryCommand);
    expect(query.input.IndexName).toBe('ByDeviceOpenedAt');
    expect(query.input.ScanIndexForward).toBe(false);
  });

  it('returns incident history newest first', async () => {
    const newest = incident({ incidentId: 'inc_new', openedAt: '2026-09-17T11:00:00.000Z' });
    const older = incident({ incidentId: 'inc_old', openedAt: '2026-09-17T10:00:00.000Z' });
    const response = await setup(new MemoryDb({ Item: device() }, { Items: [newest, older] }))
      (event('/devices/cold-room-01/incidents'));
    expect(body(response).items.map((item: any) => item.incidentId)).toEqual(['inc_new', 'inc_old']);
  });

  it('defaults incident history limit to 10', async () => {
    const db = new MemoryDb({ Item: device() }, { Items: [] });
    await setup(db)(event('/devices/cold-room-01/incidents'));
    expect((db.commands[1] as QueryCommand).input.Limit).toBe(10);
  });

  it('allows incident limit 50 and rejects values above it', async () => {
    const accepted = new MemoryDb({ Item: device() }, { Items: [] });
    expect((await setup(accepted)(event('/devices/cold-room-01/incidents', { query: { limit: '50' } }))).statusCode).toBe(200);
    expect((accepted.commands[1] as QueryCommand).input.Limit).toBe(50);
    const rejected = await setup(new MemoryDb())(event('/devices/cold-room-01/incidents', { query: { limit: '51' } }));
    expect(rejected.statusCode).toBe(400);
  });

  it('maps public incident detail fields', async () => {
    const response = await setup(new MemoryDb({ Item: incident({
      aiStatus: 'READY',
      aiExplanation: 'The configured threshold was exceeded while the door was reported open.',
      aiGeneratedAt: '2026-09-17T10:01:00.000Z',
    }) }))
      (event('/incidents/inc_1'));
    expect(body(response)).toEqual({
      incidentId: 'inc_1', deviceId: 'cold-room-01', status: 'RESOLVED',
      openedAt: '2026-09-17T10:00:00.000Z', resolvedAt: '2026-09-17T10:03:00.000Z',
      peakTemperatureC: 10.4, durationSeconds: 180, aiStatus: 'READY',
      breachStartedAt: '2026-09-17T09:59:40.000Z', thresholdC: 8,
      breachGraceSeconds: 20, recoveryGraceSeconds: 15, temperatureAtOpenC: 9.2,
      latestTemperatureC: 7.1, doorStateAtOpen: 'OPEN', powerStateAtOpen: 'ON',
      notificationStatus: 'SENT', notificationSentAt: '2026-09-17T10:00:01.000Z',
      aiExplanation: 'The configured threshold was exceeded while the door was reported open.',
      aiGeneratedAt: '2026-09-17T10:01:00.000Z',
    });
  });

  it('does not expose incident dispatch or claim metadata', async () => {
    const response = await setup(new MemoryDb({ Item: incident() }))(event('/incidents/inc_1'));
    expect(response.body).not.toContain('Dispatch');
    expect(response.body).not.toContain('notificationClaim');
  });

  it('returns safe INCIDENT_NOT_FOUND', async () => {
    const response = await setup(new MemoryDb({}))(event('/incidents/inc_missing'));
    expect(response.statusCode).toBe(404);
    expect(body(response).error).toEqual({ code: 'INCIDENT_NOT_FOUND', message: 'Incident was not found', requestId: 'request-123' });
  });

  it('returns a safe 404 for an unknown route', async () => {
    const response = await setup(new MemoryDb())(event('/unknown'));
    expect(response.statusCode).toBe(404);
    expect(body(response).error.code).toBe('NOT_FOUND');
  });

  it('does not execute DynamoDB operations for an unsupported method', async () => {
    const db = new MemoryDb();
    const response = await setup(db)(event('/devices', { method: 'POST' }));
    expect(response.statusCode).toBe(405);
    expect(body(response).error.code).toBe('METHOD_NOT_ALLOWED');
    expect(db.commands).toHaveLength(0);
  });

  it('allows the localhost CORS origin', async () => {
    const response = await setup(new MemoryDb())(event('/health', { origin: 'http://localhost:3000' }));
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('allows the configured exact Amplify origin', async () => {
    const origin = 'https://main.example.amplifyapp.com';
    const response = await setup(new MemoryDb(), ['http://localhost:3000', origin])(event('/health', { origin }));
    expect(response.headers['access-control-allow-origin']).toBe(origin);
  });

  it('does not allow arbitrary CORS origins', async () => {
    const response = await setup(new MemoryDb())(event('/health', { origin: 'https://evil.example' }));
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('handles allowed OPTIONS preflight without DynamoDB access', async () => {
    const db = new MemoryDb();
    const response = await setup(db)(event('/devices', { method: 'OPTIONS', origin: 'http://localhost:3000' }));
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toBe('GET,OPTIONS');
    expect(db.commands).toHaveLength(0);
  });

  it('returns safe INTERNAL_ERROR without leaking AWS failure details', async () => {
    const response = await setup(new MemoryDb(new Error('ResourceNotFound: table secret-table does not exist')))(event('/devices'));
    expect(response.statusCode).toBe(500);
    expect(body(response).error).toEqual({ code: 'INTERNAL_ERROR', message: 'An internal error occurred', requestId: 'request-123' });
    expect(response.body).not.toContain('secret-table');
    expect(response.body).not.toContain('ResourceNotFound');
  });
});
