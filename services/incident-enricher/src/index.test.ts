import { describe, expect, it } from 'vitest';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  createIncidentEnricher,
  normalizeIncidentEvidence,
  type BedrockRuntime,
  type DocumentClient,
  type LogEntry,
} from './index.js';
import { GROUNDED_SYSTEM_PROMPT } from './prompt.js';

const openedEvent = {
  id: 'eventbridge-delivery-1',
  source: 'freshguard.incidents',
  'detail-type': 'freshguard.incident.opened',
  detail: {
    schemaVersion: 1,
    incidentId: 'inc_opened',
    deviceId: 'cold-room-01',
    openedAt: '2026-09-17T10:00:20.000Z',
  },
} as const;

function incident(overrides: Record<string, unknown> = {}) {
  return {
    incidentId: openedEvent.detail.incidentId,
    deviceId: openedEvent.detail.deviceId,
    status: 'OPEN',
    openedAt: openedEvent.detail.openedAt,
    resolvedAt: null,
    breachStartedAt: '2026-09-17T10:00:00.000Z',
    thresholdC: 8,
    breachGraceSeconds: 20,
    recoveryGraceSeconds: 15,
    temperatureAtOpenC: 9.4,
    latestTemperatureC: 9.4,
    peakTemperatureC: 10.1,
    doorStateAtOpen: 'OPEN',
    powerStateAtOpen: 'ON',
    notificationStatus: 'SENT',
    notificationSentAt: '2026-09-17T10:00:21.000Z',
    aiStatus: 'PENDING',
    aiExplanation: null,
    openedEventDispatchStatus: 'SENT',
    arbitraryInternalNote: 'do not send this prose',
    ...overrides,
  };
}

function conflict() {
  return Object.assign(new Error('raw DynamoDB conditional details'), {
    name: 'ConditionalCheckFailedException',
  });
}

class MemoryDb implements DocumentClient {
  item: Record<string, unknown> | undefined;
  commands: Array<GetCommand | UpdateCommand> = [];
  completeClaimBeforeConflict = false;
  failNextUpdate = false;

  constructor(item: Record<string, unknown> | undefined) {
    this.item = item ? structuredClone(item) : undefined;
  }

  async send(command: GetCommand | UpdateCommand) {
    this.commands.push(command);
    if (command instanceof GetCommand) {
      return { Item: this.item ? structuredClone(this.item) : undefined };
    }
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('raw DynamoDB table failure');
    }
    if (!this.item) throw new Error('raw missing incident');
    const values = command.input.ExpressionAttributeValues ?? {};
    if (values[':generating'] !== undefined && values[':pending'] !== undefined) {
      if (this.completeClaimBeforeConflict) {
        this.completeClaimBeforeConflict = false;
        this.item.aiStatus = 'GENERATING';
        this.item.aiExplanation = null;
        delete this.item.aiGeneratedAt;
        throw conflict();
      }
      if (this.item.aiStatus !== 'PENDING' || this.item.incidentId !== values[':incidentId'] ||
          this.item.deviceId !== values[':deviceId'] || this.item.openedAt !== values[':openedAt']) throw conflict();
      this.item.aiStatus = 'GENERATING';
      this.item.aiExplanation = null;
      delete this.item.aiGeneratedAt;
      return {};
    }
    if (this.item.aiStatus !== 'GENERATING' || this.item.deviceId !== values[':deviceId']) throw conflict();
    if (values[':ready'] !== undefined) {
      this.item.aiStatus = 'READY';
      this.item.aiExplanation = values[':explanation'];
      this.item.aiGeneratedAt = values[':generatedAt'];
    } else if (values[':failed'] !== undefined) {
      this.item.aiStatus = 'FAILED';
      this.item.aiExplanation = null;
      delete this.item.aiGeneratedAt;
    }
    return {};
  }
}

class MemoryBedrock implements BedrockRuntime {
  commands: ConverseCommand[] = [];
  responses: unknown[] = [];

  async send(command: ConverseCommand): Promise<unknown> {
    this.commands.push(command);
    const response = this.responses.shift() ?? {
      output: { message: { content: [{ text: 'The configured threshold was exceeded. Check the door and refrigeration equipment.' }] } },
    };
    if (response instanceof Error) throw response;
    return response;
  }
}

function setup(item: Record<string, unknown> | undefined = incident()) {
  const db = new MemoryDb(item);
  const bedrock = new MemoryBedrock();
  const logs: LogEntry[] = [];
  const handler = createIncidentEnricher({
    db,
    bedrock,
    stage: 'dev',
    incidentsTable: 'Incidents',
    modelId: 'provider.model-v1:0',
    now: () => new Date('2026-09-17T10:00:22.000Z'),
    log: (entry) => logs.push(entry),
  });
  return { db, bedrock, logs, handler };
}

function userPrompt(command: ConverseCommand): string {
  const content = command.input.messages?.[0]?.content?.[0] as { text?: string } | undefined;
  return content?.text ?? '';
}

describe('incident enrichment', () => {
  it('processes a valid incident.opened event through claim, Bedrock, and save', async () => {
    const s = setup();
    expect(await s.handler(openedEvent)).toEqual({ result: 'ready' });
    expect(s.db.commands.map((command) => command.constructor.name)).toEqual([
      'GetCommand', 'UpdateCommand', 'UpdateCommand',
    ]);
    expect(s.bedrock.commands).toHaveLength(1);
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'enrichment_started', result: 'generating' }));
    expect(s.logs).toContainEqual(expect.objectContaining({ operation: 'enrichment_saved', result: 'ready' }));
  });

  it.each([
    {},
    { ...openedEvent, source: 'other.source' },
    { ...openedEvent, 'detail-type': 'freshguard.incident.resolved' },
    { ...openedEvent, detail: { ...openedEvent.detail, incidentId: '' } },
  ])('handles an invalid EventBridge event without AWS calls', async (event) => {
    const s = setup();
    expect(await s.handler(event)).toEqual({ result: 'invalid_event' });
    expect(s.db.commands).toHaveLength(0);
    expect(s.bedrock.commands).toHaveLength(0);
  });

  it('normalizes all required deterministic evidence and derives breach duration', () => {
    expect(normalizeIncidentEvidence(incident())).toEqual({
      deviceId: 'cold-room-01',
      incidentId: 'inc_opened',
      openedAt: '2026-09-17T10:00:20.000Z',
      thresholdC: 8,
      breachGraceSeconds: 20,
      temperatureAtOpenC: 9.4,
      peakTemperatureC: 10.1,
      doorState: 'OPEN',
      powerState: 'ON',
      breachDurationSeconds: 20,
    });
  });

  it('uses a fixed safety prompt and sends only normalized evidence', async () => {
    const s = setup();
    await s.handler(openedEvent);
    const command = s.bedrock.commands[0];
    const prompt = userPrompt(command);
    expect(command.input.modelId).toBe('provider.model-v1:0');
    expect(command.input.system?.[0]?.text).toBe(GROUNDED_SYSTEM_PROMPT);
    expect(GROUNDED_SYSTEM_PROMPT).toContain('never invent readings');
    expect(GROUNDED_SYSTEM_PROMPT).toContain('Never claim a proven root cause');
    expect(GROUNDED_SYSTEM_PROMPT).toContain('food is safe or unsafe');
    expect(GROUNDED_SYSTEM_PROMPT).toContain('2 to 4 concise sentences');
    for (const value of ['cold-room-01', 'inc_opened', '10.1', 'OPEN', 'ON', 'breachDurationSeconds']) {
      expect(prompt).toContain(value);
    }
    expect(prompt).not.toContain('arbitraryInternalNote');
    expect(prompt).not.toContain('do not send this prose');
    expect(prompt).not.toContain('notificationStatus');
    expect(prompt).not.toContain('openedEventDispatchStatus');
  });

  it('persists READY, generated text, and a UTC generation timestamp', async () => {
    const s = setup();
    s.bedrock.responses.push({ output: { message: { content: [
      { text: 'Elevated readings were observed.' },
      { text: 'Check refrigeration equipment.' },
    ] } } });
    expect(await s.handler(openedEvent)).toEqual({ result: 'ready' });
    expect(s.db.item).toMatchObject({
      aiStatus: 'READY',
      aiExplanation: 'Elevated readings were observed. Check refrigeration equipment.',
      aiGeneratedAt: '2026-09-17T10:00:22.000Z',
    });
  });

  it('marks the incident FAILED with a null explanation after a Bedrock exception', async () => {
    const s = setup();
    s.bedrock.responses.push(new Error('raw AccessDeniedException and model details'));
    expect(await s.handler(openedEvent)).toEqual({ result: 'failed' });
    expect(s.db.item).toMatchObject({ aiStatus: 'FAILED', aiExplanation: null });
    expect(s.db.item).not.toHaveProperty('aiGeneratedAt');
    expect(JSON.stringify(s.logs)).not.toContain('AccessDeniedException');
  });

  it('does not change incident lifecycle or notification fields on Bedrock failure', async () => {
    const original = incident({ status: 'RESOLVED', resolvedAt: '2026-09-17T10:03:00.000Z' });
    const s = setup(original);
    s.bedrock.responses.push(new Error('timeout'));
    await s.handler(openedEvent);
    expect(s.db.item).toMatchObject({
      incidentId: original.incidentId,
      status: 'RESOLVED',
      resolvedAt: '2026-09-17T10:03:00.000Z',
      notificationStatus: 'SENT',
      notificationSentAt: '2026-09-17T10:00:21.000Z',
      thresholdC: 8,
      peakTemperatureC: 10.1,
    });
  });

  it('treats READY as complete without claiming or invoking Bedrock', async () => {
    const s = setup(incident({ aiStatus: 'READY', aiExplanation: 'Already done.',
      aiGeneratedAt: '2026-09-17T10:00:21.000Z' }));
    expect(await s.handler(openedEvent)).toEqual({ result: 'already_ready' });
    expect(s.db.commands).toHaveLength(1);
    expect(s.bedrock.commands).toHaveLength(0);
  });

  it('makes a duplicate delivery after success a no-op without duplicate data or model calls', async () => {
    const s = setup();
    expect(await s.handler(openedEvent)).toEqual({ result: 'ready' });
    expect(await s.handler(openedEvent)).toEqual({ result: 'already_ready' });
    expect(s.bedrock.commands).toHaveLength(1);
    expect(s.db.item?.aiExplanation).toBe('The configured threshold was exceeded. Check the door and refrigeration equipment.');
    expect(s.db.commands.every((command) => command instanceof GetCommand || command instanceof UpdateCommand)).toBe(true);
  });

  it('handles a concurrent successful claim without a second Bedrock invocation', async () => {
    const s = setup();
    s.db.completeClaimBeforeConflict = true;
    expect(await s.handler(openedEvent)).toEqual({ result: 'in_progress' });
    expect(s.db.item?.aiStatus).toBe('GENERATING');
    expect(s.bedrock.commands).toHaveLength(0);
  });

  it('keeps FAILED terminal and does not automatically reinvoke Bedrock', async () => {
    const s = setup(incident({ aiStatus: 'FAILED', aiExplanation: null }));
    expect(await s.handler(openedEvent)).toEqual({ result: 'already_failed' });
    expect(s.bedrock.commands).toHaveLength(0);
  });

  it.each([
    {},
    { output: { message: { content: [] } } },
    { output: { message: { content: [{ text: '   ' }] } } },
  ])('fails safely on malformed or empty Bedrock output', async (response) => {
    const s = setup();
    s.bedrock.responses.push(response);
    expect(await s.handler(openedEvent)).toEqual({ result: 'failed' });
    expect(s.db.item).toMatchObject({ aiStatus: 'FAILED', aiExplanation: null });
  });

  it('rejects an incident that does not match the event without mutation', async () => {
    const stored = incident({ deviceId: 'other-device' });
    const s = setup(stored);
    expect(await s.handler(openedEvent)).toEqual({ result: 'invalid_incident' });
    expect(s.db.item).toEqual(stored);
    expect(s.bedrock.commands).toHaveLength(0);
  });

  it('handles an incident lookup miss safely', async () => {
    const s = setup();
    s.db.item = undefined;
    expect(await s.handler(openedEvent)).toEqual({ result: 'incident_not_found' });
    expect(s.bedrock.commands).toHaveLength(0);
  });

  it('does not leak raw DynamoDB errors when a claim fails', async () => {
    const s = setup();
    s.db.failNextUpdate = true;
    expect(await s.handler(openedEvent)).toEqual({ result: 'failed' });
    expect(s.bedrock.commands).toHaveLength(0);
    expect(JSON.stringify(s.logs)).not.toContain('raw DynamoDB');
  });
});
