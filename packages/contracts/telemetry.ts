export interface TelemetryReading {
  schemaVersion: 1;
  eventId: string;
  deviceId: string;
  observedAt: string;
  temperatureC: number;
  humidityPct?: number;
  doorState?: "OPEN" | "CLOSED" | "UNKNOWN";
  powerState?: "ON" | "OFF" | "UNKNOWN";
}
