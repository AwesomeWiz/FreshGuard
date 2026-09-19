import { useState, useEffect, useRef } from 'react';
import { apiClient } from './api-client';
import { Device, TelemetryResponse, IncidentListResponse, IncidentDetail } from './api-types';

export function useDashboardData(deviceId: string) {
  const [device, setDevice] = useState<Device | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryResponse | null>(null);
  const [incidents, setIncidents] = useState<IncidentListResponse | null>(null);
  const [activeIncident, setActiveIncident] = useState<IncidentDetail | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Use refs to keep track of latest state for active incident fetching
  const deviceRef = useRef<Device | null>(null);
  deviceRef.current = device;

  useEffect(() => {
    if (!deviceId) return;

    let mounted = true;
    let deviceTimer: number;
    let telemetryTimer: number;
    let incidentsTimer: number;

    const fetchDevice = async () => {
      try {
        const data = await apiClient.getDevice(deviceId);
        if (mounted && data) {
          setDevice(data);
          setError(null);
          
          // If there's an active incident, fetch it
          if (data.activeIncidentId) {
            fetchActiveIncident(data.activeIncidentId);
          } else {
            setActiveIncident(null);
          }
        }
      } catch (err) {
        if (mounted) {
          setError('Failed to fetch device data');
        }
      } finally {
        if (mounted) setLoading(false);
        deviceTimer = window.setTimeout(fetchDevice, 2500);
      }
    };

    const fetchTelemetry = async () => {
      try {
        const data = await apiClient.getRecentTelemetry(deviceId);
        if (mounted && data) {
          setTelemetry(data);
        }
      } catch (err) {
        // ignore telemetry errors to keep old data
      } finally {
        telemetryTimer = window.setTimeout(fetchTelemetry, 4000);
      }
    };

    const fetchIncidents = async () => {
      try {
        const data = await apiClient.getRecentIncidents(deviceId);
        if (mounted && data) {
          setIncidents(data);
        }
      } catch (err) {
        // ignore errors
      } finally {
        incidentsTimer = window.setTimeout(fetchIncidents, 4000);
      }
    };

    const fetchActiveIncident = async (incidentId: string) => {
      try {
        const data = await apiClient.getIncident(incidentId);
        if (mounted && data) {
          setActiveIncident(data);
        }
      } catch (err) {
        // ignore errors
      }
    };

    // Initial fetches
    fetchDevice();
    fetchTelemetry();
    fetchIncidents();

    return () => {
      mounted = false;
      window.clearTimeout(deviceTimer);
      window.clearTimeout(telemetryTimer);
      window.clearTimeout(incidentsTimer);
    };
  }, [deviceId]);

  return { device, telemetry, incidents, activeIncident, error, loading };
}
