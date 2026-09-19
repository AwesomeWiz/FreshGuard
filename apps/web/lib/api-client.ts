import { Device, TelemetryResponse, IncidentListResponse, IncidentDetail } from './api-types';

const getBaseUrl = () => process.env.NEXT_PUBLIC_API_BASE_URL || '';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = \\\\;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(\API Error \: \\);
  }
  
  // Return null or empty object if 204 or empty string (handle gracefully where practical)
  const text = await response.text();
  if (!text) {
    return null as T;
  }
  
  return JSON.parse(text) as T;
}

export const apiClient = {
  getHealth: () => fetchApi<{ status: string }>('/health'),
  
  getDevices: () => fetchApi<{ items: Device[] }>('/devices'),
  
  getDevice: (deviceId: string) => fetchApi<Device>(\/devices/\\),
  
  getRecentTelemetry: (deviceId: string, minutes: number = 30, limit: number = 300) => 
    fetchApi<TelemetryResponse>(\/devices/\/telemetry?minutes=\&limit=\\),
  
  getRecentIncidents: (deviceId: string, limit: number = 10) => 
    fetchApi<IncidentListResponse>(\/devices/\/incidents?limit=\\),
  
  getIncident: (incidentId: string) => 
    fetchApi<IncidentDetail>(\/incidents/\\),
};
