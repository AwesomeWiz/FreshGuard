export type MonitoringState = "NORMAL" | "WATCHING" | "ACTIVE" | "RECOVERING";
export type PresentationState = "HEALTHY" | "WATCHING" | "INCIDENT" | "RECOVERING";
export type DoorState = "OPEN" | "CLOSED" | "UNKNOWN";
export type PowerState = "ON" | "OFF" | "UNKNOWN";
export type IncidentStatus = "OPEN" | "RESOLVED";
export type AiStatus = "GENERATING" | "READY" | "FAILED";

export interface DeviceConfiguration {
  maxTemperatureC: number;
  breachGraceSeconds: number;
  recoveryGraceSeconds: number;
  staleAfterSeconds: number;
}

export interface LatestTelemetry {
  observedAt: string;
  temperatureC: number;
  humidityPct?: number;
  doorState?: DoorState;
  powerState?: PowerState;
}

export interface Device {
  deviceId: string;
  displayName: string;
  monitoringState: MonitoringState;
  presentationState: PresentationState;
  configuration: DeviceConfiguration;
  latest: LatestTelemetry;
  activeIncidentId: string | null;
}

export interface TelemetrySample {
  observedAt: string;
  temperatureC: number;
  humidityPct?: number;
  doorState?: DoorState;
  powerState?: PowerState;
}

export interface TelemetryResponse {
  deviceId: string;
  items: TelemetrySample[];
}

export interface IncidentSummary {
  incidentId: string;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt: string | null;
  peakTemperatureC: number;
  durationSeconds: number | null;
  aiStatus?: AiStatus;
}

export interface IncidentListResponse {
  deviceId: string;
  items: IncidentSummary[];
}

export interface IncidentDetail {
  incidentId: string;
  deviceId: string;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt: string | null;
  breachStartedAt: string;
  thresholdC: number;
  breachGraceSeconds: number;
  recoveryGraceSeconds: number;
  temperatureAtOpenC: number;
  latestTemperatureC: number;
  peakTemperatureC: number;
  doorStateAtOpen: DoorState;
  powerStateAtOpen: PowerState;
  notificationStatus: string;
  notificationSentAt: string | null;
  aiStatus?: AiStatus;
  aiExplanation?: string | null;
  aiGeneratedAt?: string | null;
  durationSeconds: number | null;
  eventDispatchStatus?: string;
}

export interface ApiError {
  error: string;
  status: number;
}
