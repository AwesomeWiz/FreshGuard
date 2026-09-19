import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

type DbCommand = GetCommand | QueryCommand | ScanCommand;

export interface DocumentClient {
  send(command: DbCommand): Promise<{
    Item?: Record<string, unknown>;
    Items?: Record<string, unknown>[];
  }>;
}

export interface ApiEvent {
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext: {
    requestId?: string;
    stage?: string;
    http: { method: string; path: string };
  };
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface LogEntry {
  level: 'INFO' | 'WARN' | 'ERROR';
  operation: 'api_request' | 'api_request_failed';
  stage: string;
  requestId: string;
  method: string;
  route: string;
  statusCode?: number;
  result?: string;
  deviceId?: string;
  incidentId?: string;
}

export interface HandlerDependencies {
  db: DocumentClient;
  stage: string;
  devicesTable: string;
  telemetryTable: string;
  incidentsTable: string;
  incidentsByDeviceIndex?: string;
  allowedOrigins?: string[];
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

type MonitoringState = 'NORMAL' | 'WATCHING' | 'ACTIVE' | 'RECOVERING';
type PresentationState = 'HEALTHY' | 'WATCHING' | 'INCIDENT' | 'RECOVERING';

export interface DeviceListDto {
  deviceId: string;
  displayName: string;
  monitoringState: MonitoringState;
  lastSeenAt: string | null;
  latestTemperatureC: number | null;
}

export interface LatestTelemetryDto {
  observedAt: string;
  temperatureC: number;
  humidityPct?: number;
  doorState?: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  powerState?: 'ON' | 'OFF' | 'UNKNOWN';
}

export interface DeviceDetailDto {
  deviceId: string;
  displayName: string;
  monitoringState: MonitoringState;
  presentationState: PresentationState;
  configuration: {
    maxTemperatureC: number;
    breachGraceSeconds: number;
    recoveryGraceSeconds: number;
    staleAfterSeconds: number;
  };
  latest: LatestTelemetryDto | null;
  activeIncidentId: string | null;
}

export interface IncidentHistoryDto {
  incidentId: string;
  status: 'OPEN' | 'RESOLVED';
  openedAt: string;
  resolvedAt: string | null;
  peakTemperatureC: number;
  durationSeconds: number | null;
  aiStatus: string;
}

export interface IncidentDetailDto extends IncidentHistoryDto {
  deviceId: string;
  breachStartedAt: string;
  thresholdC: number;
  breachGraceSeconds: number;
  recoveryGraceSeconds: number;
  temperatureAtOpenC: number;
  latestTemperatureC: number;
  doorStateAtOpen: string;
  powerStateAtOpen: string;
  notificationStatus: string;
  notificationSentAt: string | null;
  aiExplanation: string | null;
  aiGeneratedAt?: string;
}

const DEVICE_SCAN_LIMIT = 50;
const DEFAULT_TELEMETRY_MINUTES = 30;
const MAX_TELEMETRY_MINUTES = 1_440;
const DEFAULT_TELEMETRY_LIMIT = 300;
const MAX_TELEMETRY_LIMIT = 300;
const DEFAULT_INCIDENT_LIMIT = 10;
const MAX_INCIDENT_LIMIT = 50;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const INCIDENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MONITORING_STATES: MonitoringState[] = ['NORMAL', 'WATCHING', 'ACTIVE', 'RECOVERING'];

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class StoredDataError extends Error {}

function stringField(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== 'string' || value.length === 0) throw new StoredDataError(`Invalid ${field}`);
  return value;
}

function numberField(item: Record<string, unknown>, field: string): number {
  const value = item[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new StoredDataError(`Invalid ${field}`);
  return value;
}

function nullableString(item: Record<string, unknown>, field: string): string | null {
  const value = item[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new StoredDataError(`Invalid ${field}`);
  return value;
}

function nullableNumber(item: Record<string, unknown>, field: string): number | null {
  const value = item[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new StoredDataError(`Invalid ${field}`);
  return value;
}

function monitoringState(item: Record<string, unknown>): MonitoringState {
  const value = item.monitoringState;
  if (typeof value !== 'string' || !MONITORING_STATES.includes(value as MonitoringState)) {
    throw new StoredDataError('Invalid monitoringState');
  }
  return value as MonitoringState;
}

export function mapPresentationState(state: MonitoringState): PresentationState {
  const presentations: Record<MonitoringState, PresentationState> = {
    NORMAL: 'HEALTHY',
    WATCHING: 'WATCHING',
    ACTIVE: 'INCIDENT',
    RECOVERING: 'RECOVERING',
  };
  return presentations[state];
}

export function mapLatestTelemetry(item: Record<string, unknown>): LatestTelemetryDto {
  const dto: LatestTelemetryDto = {
    observedAt: stringField(item, 'observedAt'),
    temperatureC: numberField(item, 'temperatureC'),
  };
  if (item.humidityPct !== undefined) dto.humidityPct = numberField(item, 'humidityPct');
  if (item.doorState !== undefined) {
    const value = stringField(item, 'doorState');
    if (value !== 'OPEN' && value !== 'CLOSED' && value !== 'UNKNOWN') throw new StoredDataError('Invalid doorState');
    dto.doorState = value;
  }
  if (item.powerState !== undefined) {
    const value = stringField(item, 'powerState');
    if (value !== 'ON' && value !== 'OFF' && value !== 'UNKNOWN') throw new StoredDataError('Invalid powerState');
    dto.powerState = value;
  }
  return dto;
}

export function mapDeviceListItem(item: Record<string, unknown>): DeviceListDto {
  const deviceId = stringField(item, 'deviceId');
  const latest = item.latest;
  if (latest !== undefined && (typeof latest !== 'object' || latest === null || Array.isArray(latest))) {
    throw new StoredDataError('Invalid latest');
  }
  return {
    deviceId,
    displayName: typeof item.displayName === 'string' && item.displayName.length > 0 ? item.displayName : deviceId,
    monitoringState: monitoringState(item),
    lastSeenAt: nullableString(item, 'lastSeenAt'),
    latestTemperatureC: latest ? nullableNumber(latest as Record<string, unknown>, 'temperatureC') : null,
  };
}

export function mapDeviceDetail(item: Record<string, unknown>): DeviceDetailDto {
  const deviceId = stringField(item, 'deviceId');
  const state = monitoringState(item);
  const latest = item.latest;
  if (latest !== undefined && latest !== null &&
      (typeof latest !== 'object' || Array.isArray(latest))) throw new StoredDataError('Invalid latest');
  return {
    deviceId,
    displayName: typeof item.displayName === 'string' && item.displayName.length > 0 ? item.displayName : deviceId,
    monitoringState: state,
    presentationState: mapPresentationState(state),
    configuration: {
      maxTemperatureC: numberField(item, 'maxTemperatureC'),
      breachGraceSeconds: numberField(item, 'breachGraceSeconds'),
      recoveryGraceSeconds: numberField(item, 'recoveryGraceSeconds'),
      staleAfterSeconds: numberField(item, 'staleAfterSeconds'),
    },
    latest: latest ? mapLatestTelemetry(latest as Record<string, unknown>) : null,
    activeIncidentId: nullableString(item, 'activeIncidentId'),
  };
}

export function mapIncidentHistory(item: Record<string, unknown>): IncidentHistoryDto {
  const status = stringField(item, 'status');
  if (status !== 'OPEN' && status !== 'RESOLVED') throw new StoredDataError('Invalid status');
  return {
    incidentId: stringField(item, 'incidentId'),
    status,
    openedAt: stringField(item, 'openedAt'),
    resolvedAt: nullableString(item, 'resolvedAt'),
    peakTemperatureC: numberField(item, 'peakTemperatureC'),
    durationSeconds: nullableNumber(item, 'durationSeconds'),
    aiStatus: stringField(item, 'aiStatus'),
  };
}

export function mapIncidentDetail(item: Record<string, unknown>): IncidentDetailDto {
  const dto: IncidentDetailDto = {
    ...mapIncidentHistory(item),
    deviceId: stringField(item, 'deviceId'),
    breachStartedAt: stringField(item, 'breachStartedAt'),
    thresholdC: numberField(item, 'thresholdC'),
    breachGraceSeconds: numberField(item, 'breachGraceSeconds'),
    recoveryGraceSeconds: numberField(item, 'recoveryGraceSeconds'),
    temperatureAtOpenC: numberField(item, 'temperatureAtOpenC'),
    latestTemperatureC: numberField(item, 'latestTemperatureC'),
    doorStateAtOpen: stringField(item, 'doorStateAtOpen'),
    powerStateAtOpen: stringField(item, 'powerStateAtOpen'),
    notificationStatus: stringField(item, 'notificationStatus'),
    notificationSentAt: nullableString(item, 'notificationSentAt'),
    aiExplanation: nullableString(item, 'aiExplanation'),
  };
  if (item.aiGeneratedAt !== undefined && item.aiGeneratedAt !== null) {
    dto.aiGeneratedAt = stringField(item, 'aiGeneratedAt');
  }
  return dto;
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function validatedId(value: string | undefined, kind: 'device' | 'incident'): string {
  const pattern = kind === 'device' ? DEVICE_ID : INCIDENT_ID;
  if (!value || !pattern.test(value)) {
    throw new ApiError(400, 'INVALID_QUERY', `${kind} identifier is invalid`);
  }
  return value;
}

function decodedId(segment: string, kind: 'device' | 'incident'): string {
  try {
    return validatedId(decodeURIComponent(segment), kind);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_QUERY', `${kind} identifier is invalid`);
  }
}

function normalizedPath(event: ApiEvent): string {
  let path = event.rawPath ?? event.requestContext.http.path;
  const stagePrefix = event.requestContext.stage ? `/${event.requestContext.stage}` : '';
  if (stagePrefix && path.startsWith(`${stagePrefix}/`)) path = path.slice(stagePrefix.length);
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

function header(event: ApiEvent, name: string): string | undefined {
  const entry = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function responseHeaders(event: ApiEvent, allowedOrigins: string[]): Record<string, string> {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  const origin = header(event, 'origin');
  return origin && allowedOrigins.includes(origin)
    ? { ...headers, 'access-control-allow-origin': origin, vary: 'Origin' }
    : headers;
}

function jsonResponse(event: ApiEvent, allowedOrigins: string[], statusCode: number, body: unknown): ApiResponse {
  return { statusCode, headers: responseHeaders(event, allowedOrigins), body: JSON.stringify(body) };
}

function routeLabel(path: string): string {
  if (/^\/devices\/[^/]+\/telemetry$/.test(path)) return '/devices/{deviceId}/telemetry';
  if (/^\/devices\/[^/]+\/incidents$/.test(path)) return '/devices/{deviceId}/incidents';
  if (/^\/devices\/[^/]+$/.test(path)) return '/devices/{deviceId}';
  if (/^\/incidents\/[^/]+$/.test(path)) return '/incidents/{incidentId}';
  return path;
}

export function createReadApiHandler({
  db, stage, devicesTable, telemetryTable, incidentsTable,
  incidentsByDeviceIndex = 'ByDeviceOpenedAt',
  allowedOrigins = ['http://localhost:3000'],
  now = () => new Date(),
  log = (entry) => console.log(JSON.stringify(entry)),
}: HandlerDependencies) {
  return async (event: ApiEvent): Promise<ApiResponse> => {
    const method = event.requestContext.http.method.toUpperCase();
    const path = normalizedPath(event);
    const route = routeLabel(path);
    const requestId = event.requestContext.requestId ?? 'unknown';
    const context = { stage, requestId, method, route };
    log({ level: 'INFO', operation: 'api_request', ...context });

    try {
      if (method === 'OPTIONS') {
        const headers = responseHeaders(event, allowedOrigins);
        const origin = header(event, 'origin');
        if (origin && allowedOrigins.includes(origin)) {
          headers['access-control-allow-methods'] = 'GET,OPTIONS';
          headers['access-control-allow-headers'] = 'content-type';
        }
        return { statusCode: 204, headers, body: '' };
      }
      if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed');

      let body: unknown;
      let deviceId: string | undefined;
      let incidentId: string | undefined;

      if (path === '/health') {
        body = { status: 'ok', service: 'freshguard-api' };
      } else if (path === '/devices') {
        const result = await db.send(new ScanCommand({ TableName: devicesTable, Limit: DEVICE_SCAN_LIMIT }));
        body = { items: (result.Items ?? []).map(mapDeviceListItem).sort((a, b) => a.deviceId.localeCompare(b.deviceId)) };
      } else {
        const telemetryMatch = path.match(/^\/devices\/([^/]+)\/telemetry$/);
        const incidentsMatch = path.match(/^\/devices\/([^/]+)\/incidents$/);
        const deviceMatch = path.match(/^\/devices\/([^/]+)$/);
        const incidentMatch = path.match(/^\/incidents\/([^/]+)$/);

        if (telemetryMatch) {
          deviceId = decodedId(telemetryMatch[1], 'device');
          const minutes = boundedInteger(event.queryStringParameters?.minutes, DEFAULT_TELEMETRY_MINUTES, MAX_TELEMETRY_MINUTES, 'minutes');
          const limit = boundedInteger(event.queryStringParameters?.limit, DEFAULT_TELEMETRY_LIMIT, MAX_TELEMETRY_LIMIT, 'limit');
          const device = await db.send(new GetCommand({ TableName: devicesTable, Key: { deviceId }, ConsistentRead: true }));
          if (!device.Item) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'Device was not found');
          const startAt = new Date(now().getTime() - minutes * 60_000).toISOString();
          const result = await db.send(new QueryCommand({
            TableName: telemetryTable,
            KeyConditionExpression: 'deviceId = :deviceId AND sampleKey >= :startKey',
            ExpressionAttributeValues: { ':deviceId': deviceId, ':startKey': `${startAt}#` },
            ScanIndexForward: false,
            Limit: limit,
          }));
          body = { deviceId, items: (result.Items ?? []).map(mapLatestTelemetry).reverse() };
        } else if (incidentsMatch) {
          deviceId = decodedId(incidentsMatch[1], 'device');
          const limit = boundedInteger(event.queryStringParameters?.limit, DEFAULT_INCIDENT_LIMIT, MAX_INCIDENT_LIMIT, 'limit');
          const device = await db.send(new GetCommand({ TableName: devicesTable, Key: { deviceId }, ConsistentRead: true }));
          if (!device.Item) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'Device was not found');
          const result = await db.send(new QueryCommand({
            TableName: incidentsTable,
            IndexName: incidentsByDeviceIndex,
            KeyConditionExpression: 'deviceId = :deviceId',
            ExpressionAttributeValues: { ':deviceId': deviceId },
            ScanIndexForward: false,
            Limit: limit,
          }));
          body = { deviceId, items: (result.Items ?? []).map(mapIncidentHistory) };
        } else if (deviceMatch) {
          deviceId = decodedId(deviceMatch[1], 'device');
          const result = await db.send(new GetCommand({ TableName: devicesTable, Key: { deviceId }, ConsistentRead: true }));
          if (!result.Item) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'Device was not found');
          body = mapDeviceDetail(result.Item);
        } else if (incidentMatch) {
          incidentId = decodedId(incidentMatch[1], 'incident');
          const result = await db.send(new GetCommand({ TableName: incidentsTable, Key: { incidentId }, ConsistentRead: true }));
          if (!result.Item) throw new ApiError(404, 'INCIDENT_NOT_FOUND', 'Incident was not found');
          body = mapIncidentDetail(result.Item);
        } else {
          throw new ApiError(404, 'NOT_FOUND', 'Route was not found');
        }
      }

      log({ level: 'INFO', operation: 'api_request', ...context, statusCode: 200, result: 'success',
        ...(deviceId ? { deviceId } : {}), ...(incidentId ? { incidentId } : {}) });
      return jsonResponse(event, allowedOrigins, 200, body);
    } catch (error) {
      const apiError = error instanceof ApiError
        ? error
        : new ApiError(500, 'INTERNAL_ERROR', 'An internal error occurred');
      log({
        level: apiError.statusCode >= 500 ? 'ERROR' : 'WARN',
        operation: 'api_request_failed',
        ...context,
        statusCode: apiError.statusCode,
        result: apiError.code,
      });
      return jsonResponse(event, allowedOrigins, apiError.statusCode, {
        error: { code: apiError.code, message: apiError.message, requestId },
      });
    }
  };
}
