import { describe, expect, it } from 'vitest';
import { parseTelemetryPayload, type TelemetryPayload } from './index.js';

const valid: TelemetryPayload = {
  schemaVersion: 1,
  eventId: '4dbfa4e7-3764-4f15-9c51-f23e249e2fe1',
  deviceId: 'cold-room-01',
  observedAt: '2026-09-17T10:15:35.000Z',
  temperatureC: 9.4,
  humidityPct: 66,
  doorState: 'OPEN',
  powerState: 'ON',
};

function expectInvalid(input: unknown, field: keyof TelemetryPayload | 'payload') {
  const result = parseTelemetryPayload(input);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.field).toBe(field);
    expect(result.error.message).toEqual(expect.any(String));
  }
  return result;
}

describe('parseTelemetryPayload', () => {
  it('accepts valid telemetry without changing its values', () => {
    expect(parseTelemetryPayload(valid)).toEqual({ success: true, data: valid });
  });

  it.each(['schemaVersion', 'eventId', 'deviceId', 'observedAt', 'temperatureC'] as const)(
    'rejects missing required field %s', (field) => {
      const input: Record<string, unknown> = { ...valid };
      delete input[field];
      expect(expectInvalid(input, field)).toMatchObject({ error: { code: 'REQUIRED' } });
    },
  );

  it.each([0, 2, '1', null])('rejects unsupported schemaVersion %s', (schemaVersion) => {
    expect(expectInvalid({ ...valid, schemaVersion }, 'schemaVersion')).toMatchObject({
      error: { code: 'UNSUPPORTED_SCHEMA_VERSION' },
    });
  });

  it.each(['', ' ', 'event id', 'event-01\n', 'a'.repeat(129), 123, null])(
    'rejects invalid eventId %s', (eventId) => {
      expectInvalid({ ...valid, eventId }, 'eventId');
    },
  );

  it.each(['', ' ', 'cold room', 'cold/room', 'cold-room-01\n', '-cold-room', 'a'.repeat(65), 123, null])(
    'rejects invalid or unbounded deviceId %s', (deviceId) => {
      expectInvalid({ ...valid, deviceId }, 'deviceId');
    },
  );

  it('accepts bounded identifiers without requiring a strict UUID', () => {
    expect(parseTelemetryPayload({ ...valid, eventId: 'a'.repeat(128), deviceId: 'a'.repeat(64) }).success)
      .toBe(true);
  });

  it.each([
    '', 'not-a-date', '2026-09-17', '2026-09-17T10:15:35',
    '2026-09-17T10:15:35+05:30', '2026-09-17T10:15:35-01:00',
    '2026-02-30T10:15:35Z', '2026-02-29T10:15:35Z',
    '2026-13-17T10:15:35Z', '2026-09-17T24:00:00Z',
    '2026-09-17T10:60:35Z', '2026-09-17T10:15:60Z', 123, null,
  ])('rejects invalid or non-UTC observedAt %s', (observedAt) => {
    expectInvalid({ ...valid, observedAt }, 'observedAt');
  });

  it.each([
    '2026-09-17T10:15:35Z', '2026-09-17T10:15:35.1Z',
    '2026-09-17T10:15:35.123456Z', '2026-09-17T10:15:35+00:00',
    '2028-02-29T10:15:35.000Z',
  ])('accepts UTC observedAt %s', (observedAt) => {
    expect(parseTelemetryPayload({ ...valid, observedAt })).toMatchObject({
      success: true, data: { observedAt },
    });
  });

  it.each(['9.4', null, true, NaN, Infinity, -Infinity, -100.01, 200.01])(
    'rejects non-number, non-finite or out-of-range temperature %s', (temperatureC) => {
      expectInvalid({ ...valid, temperatureC }, 'temperatureC');
    },
  );

  it.each([-100, 200])('accepts technical temperature boundary %s', (temperatureC) => {
    expect(parseTelemetryPayload({ ...valid, temperatureC }).success).toBe(true);
  });

  it.each(['open', '', 'AJAR', null, 123])('rejects invalid doorState %s', (doorState) => {
    expectInvalid({ ...valid, doorState }, 'doorState');
  });

  it.each(['on', '', 'RUNNING', null, 123])('rejects invalid powerState %s', (powerState) => {
    expectInvalid({ ...valid, powerState }, 'powerState');
  });

  it.each(['OPEN', 'CLOSED', 'UNKNOWN'])('accepts doorState %s', (doorState) => {
    expect(parseTelemetryPayload({ ...valid, doorState }).success).toBe(true);
  });

  it.each(['ON', 'OFF', 'UNKNOWN'])('accepts powerState %s', (powerState) => {
    expect(parseTelemetryPayload({ ...valid, powerState }).success).toBe(true);
  });

  it.each([-0.01, 100.01, '66', NaN, Infinity, -Infinity, null])(
    'rejects invalid humidityPct %s', (humidityPct) => {
      expectInvalid({ ...valid, humidityPct }, 'humidityPct');
    },
  );

  it.each([0, 100])('accepts humidity boundary %s', (humidityPct) => {
    expect(parseTelemetryPayload({ ...valid, humidityPct }).success).toBe(true);
  });

  it('accepts omitted contextual fields and leaves them absent without defaults', () => {
    const { humidityPct, doorState, powerState, ...requiredOnly } = valid;
    expect(parseTelemetryPayload(requiredOnly)).toEqual({ success: true, data: requiredOnly });
    expect(parseTelemetryPayload({ ...requiredOnly, humidityPct: undefined,
      doorState: undefined, powerState: undefined })).toEqual({ success: true, data: requiredOnly });
  });

  it.each([null, undefined, [], 'json', 123])('rejects non-object payload %s', (input) => {
    expectInvalid(input, 'payload');
  });

  it('returns only validated fields without mutating the input', () => {
    const input = Object.freeze({ ...valid, extra: 'ignored' });
    expect(parseTelemetryPayload(input)).toEqual({ success: true, data: valid });
    expect(input.extra).toBe('ignored');
  });

  it('does not echo raw invalid values in errors', () => {
    const result = expectInvalid({ ...valid, deviceId: 'raw value with spaces' }, 'deviceId');
    expect(JSON.stringify(result)).not.toContain('raw value with spaces');
  });
});
