export type MonitoringState = "NORMAL" | "WATCHING" | "ACTIVE" | "RECOVERING";
export type DoorState = "OPEN" | "CLOSED" | "UNKNOWN";
export type PowerState = "ON" | "OFF" | "UNKNOWN";

export interface DeviceResponse {
  deviceId: string;
  displayName: string;
  monitoringState: MonitoringState;
  presentationState: "HEALTHY" | "WATCHING" | "INCIDENT" | "RECOVERING";
  configuration: {
    maxTemperatureC: number;
    breachGraceSeconds: number;
    recoveryGraceSeconds: number;
    staleAfterSeconds: number;
  };
  latest: {
    observedAt: string;
    temperatureC: number;
    humidityPct?: number;
    doorState?: DoorState;
    powerState?: PowerState;
  };
  activeIncidentId: string | null;
}

export interface TelemetryResponse {
  deviceId: string;
  items: Array<{
    observedAt: string;
    temperatureC: number;
    humidityPct?: number;
    doorState?: DoorState;
    powerState?: PowerState;
  }>;
}

export interface IncidentListResponse {
  deviceId: string;
  items: Array<{
    incidentId: string;
    status: "OPEN" | "RESOLVED";
    openedAt: string;
    resolvedAt: string | null;
    peakTemperatureC: number;
    durationSeconds: number | null;
    aiStatus: "GENERATING" | "READY" | "FAILED";
  }>;
}


export interface IncidentDetailResponse {
  incidentId: string;
  deviceId: string;
  status: IncidentListResponse["items"][number]["status"];
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
  aiStatus: IncidentListResponse["items"][number]["aiStatus"];
  aiExplanation: string | null;
  aiGeneratedAt: string | null;
  durationSeconds: number | null;
  eventDispatchStatus: string;
}

export const mockActiveIncident: IncidentDetailResponse | null = null;

export const mockDevice: DeviceResponse = {
  deviceId: "cold-room-01",
  displayName: "Cold Room 01",
  monitoringState: "NORMAL",
  presentationState: "HEALTHY",
  configuration: {
    maxTemperatureC: 8,
    breachGraceSeconds: 20,
    recoveryGraceSeconds: 15,
    staleAfterSeconds: 20,
  },
  latest: {
    observedAt: "2026-09-17T16:30:00.000Z",
    temperatureC: 4.3,
    humidityPct: 64,
    doorState: "CLOSED",
    powerState: "ON",
  },
  activeIncidentId: null,
};

export const mockTelemetry: TelemetryResponse = {
  deviceId: "cold-room-01",
  items: [
    { observedAt: "2026-09-17T16:29:52.000Z", temperatureC: 4.2, humidityPct: 64, doorState: "CLOSED", powerState: "ON" },
    { observedAt: "2026-09-17T16:29:54.000Z", temperatureC: 4.4, humidityPct: 64, doorState: "CLOSED", powerState: "ON" },
    { observedAt: "2026-09-17T16:29:56.000Z", temperatureC: 4.6, humidityPct: 65, doorState: "CLOSED", powerState: "ON" },
    { observedAt: "2026-09-17T16:30:00.000Z", temperatureC: 4.3, humidityPct: 64, doorState: "CLOSED", powerState: "ON" }
  ],
};

export const mockIncidents: IncidentListResponse = {
  deviceId: "cold-room-01",
  items: [],
};
