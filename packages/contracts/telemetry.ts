export type DoorState = 'OPEN' | 'CLOSED' | 'UNKNOWN';
export type PowerState = 'ON' | 'OFF' | 'UNKNOWN';

export interface TelemetryReading {
  schemaVersion: 1;
  eventId: string;
  deviceId: string;
  observedAt: string;
  temperatureC: number;
  humidityPct?: number;
  doorState?: DoorState;
  powerState?: PowerState;
}

export type TelemetryPayload = TelemetryReading;

export interface TelemetryValidationError {
  field: keyof TelemetryPayload | 'payload';
  code: 'REQUIRED' | 'INVALID' | 'UNSUPPORTED_SCHEMA_VERSION';
  message: string;
}

export type TelemetryValidationResult =
  | { success: true; data: TelemetryPayload }
  | { success: false; error: TelemetryValidationError };

function invalid(
  field: TelemetryValidationError['field'],
  message: string,
  code: TelemetryValidationError['code'] = 'INVALID',
): TelemetryValidationResult {
  return { success: false, error: { field, code, message } };
}

function isUtcTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value)
  ) {
    return false;
  }

  const timestamp = Date.parse(value);
  // Date.parse can normalize impossible dates (for example February 30).
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Validate a decoded JSON payload without coercion; return the first field error. */
export function parseTelemetryPayload(input: unknown): TelemetryValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalid('payload', 'Telemetry payload must be an object');
  }

  const payload = input as Record<string, unknown>;
  const required = ['schemaVersion', 'eventId', 'deviceId', 'observedAt', 'temperatureC'] as const;
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] === undefined) {
      return invalid(field, `${field} is required`, 'REQUIRED');
    }
  }

  const { schemaVersion, eventId, deviceId, observedAt, temperatureC,
    humidityPct, doorState, powerState } = payload;

  if (schemaVersion !== 1) {
    return invalid('schemaVersion', 'Only schemaVersion 1 is supported', 'UNSUPPORTED_SCHEMA_VERSION');
  }
  if (typeof eventId !== 'string' || eventId !== eventId.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(eventId)) {
    return invalid('eventId', 'eventId must be a 1..128 character identifier');
  }
  if (typeof deviceId !== 'string' || deviceId !== deviceId.trim() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(deviceId)) {
    return invalid('deviceId', 'deviceId must be 1..64 letters, digits, underscores or hyphens, starting with a letter or digit');
  }
  if (!isUtcTimestamp(observedAt)) {
    return invalid('observedAt', 'observedAt must be a valid UTC ISO-8601 timestamp');
  }
  // Technical malformed-data protection, unrelated to configured breach thresholds.
  if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC < -100 || temperatureC > 200) {
    return invalid('temperatureC', 'temperatureC must be a finite number in -100..200');
  }
  if (humidityPct !== undefined &&
    (typeof humidityPct !== 'number' || !Number.isFinite(humidityPct) || humidityPct < 0 || humidityPct > 100)) {
    return invalid('humidityPct', 'humidityPct must be a finite number in 0..100');
  }
  if (doorState !== undefined && doorState !== 'OPEN' && doorState !== 'CLOSED' && doorState !== 'UNKNOWN') {
    return invalid('doorState', 'doorState must be OPEN, CLOSED or UNKNOWN');
  }
  if (powerState !== undefined && powerState !== 'ON' && powerState !== 'OFF' && powerState !== 'UNKNOWN') {
    return invalid('powerState', 'powerState must be ON, OFF or UNKNOWN');
  }

  return {
    success: true,
    data: {
      schemaVersion, eventId, deviceId, observedAt, temperatureC,
      ...(humidityPct !== undefined ? { humidityPct } : {}),
      ...(doorState !== undefined ? { doorState } : {}),
      ...(powerState !== undefined ? { powerState } : {}),
    },
  };
}
