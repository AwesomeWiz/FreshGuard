import type {
  ApiError,
  ApiErrorResponse,
  Device,
  DevicesResponse,
  HealthResponse,
  IncidentDetail,
  IncidentsResponse,
  TelemetryResponse,
} from "@/lib/api-types";

const DEFAULT_TELEMETRY_MINUTES = 30;
const DEFAULT_TELEMETRY_LIMIT = 300;
const DEFAULT_INCIDENT_LIMIT = 10;

export class FreshGuardApiError extends Error {
  readonly details: ApiError;

  constructor(details: ApiError) {
    super(details.message);
    this.name = "FreshGuardApiError";
    this.details = details;
  }
}

function getApiBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  if (!value) {
    throw new FreshGuardApiError({
      code: "API_BASE_URL_MISSING",
      message: "FreshGuard API is not configured.",
    });
  }

  return value.replace(/\/$/, "");
}

function buildUrl(path: string): string {
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseErrorPayload(value: unknown): ApiErrorResponse["error"] | null {
  if (!isObject(value) || !isObject(value.error)) {
    return null;
  }

  const code = typeof value.error.code === "string" ? value.error.code : "API_ERROR";
  const message = typeof value.error.message === "string" ? value.error.message : "Request failed";
  const requestId = typeof value.error.requestId === "string" ? value.error.requestId : undefined;

  return { code, message, ...(requestId ? { requestId } : {}) };
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(buildUrl(path), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new FreshGuardApiError({
      code: "NETWORK_ERROR",
      message: "FreshGuard API is temporarily unavailable.",
    });
  }

  let payload: unknown = null;
  const text = await response.text();

  if (text.trim()) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      if (response.ok) {
        throw new FreshGuardApiError({
          code: "INVALID_RESPONSE",
          message: "FreshGuard API returned an invalid response.",
          status: response.status,
        });
      }
    }
  }

  if (!response.ok) {
    const apiError = parseErrorPayload(payload);
    throw new FreshGuardApiError({
      code: apiError?.code ?? "HTTP_ERROR",
      message: response.status >= 500
        ? "FreshGuard API is temporarily unavailable."
        : apiError?.message ?? "FreshGuard request failed.",
      requestId: apiError?.requestId,
      status: response.status,
    });
  }

  if (payload === null || payload === undefined) {
    throw new FreshGuardApiError({
      code: "EMPTY_RESPONSE",
      message: "FreshGuard API returned an empty response.",
      status: response.status,
    });
  }

  return payload as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/health", signal);
}

export function getDevices(signal?: AbortSignal): Promise<DevicesResponse> {
  return requestJson<DevicesResponse>("/devices", signal);
}

export function getDevice(deviceId: string, signal?: AbortSignal): Promise<Device> {
  return requestJson<Device>(`/devices/${encodeURIComponent(deviceId)}`, signal);
}

export function getRecentTelemetry(
  deviceId: string,
  signal?: AbortSignal,
  minutes = DEFAULT_TELEMETRY_MINUTES,
  limit = DEFAULT_TELEMETRY_LIMIT,
): Promise<TelemetryResponse> {
  const query = new URLSearchParams({ minutes: String(minutes), limit: String(limit) });
  return requestJson<TelemetryResponse>(
    `/devices/${encodeURIComponent(deviceId)}/telemetry?${query.toString()}`,
    signal,
  );
}

export function getRecentIncidents(
  deviceId: string,
  signal?: AbortSignal,
  limit = DEFAULT_INCIDENT_LIMIT,
): Promise<IncidentsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return requestJson<IncidentsResponse>(
    `/devices/${encodeURIComponent(deviceId)}/incidents?${query.toString()}`,
    signal,
  );
}

export function getIncident(incidentId: string, signal?: AbortSignal): Promise<IncidentDetail> {
  return requestJson<IncidentDetail>(`/incidents/${encodeURIComponent(incidentId)}`, signal);
}
