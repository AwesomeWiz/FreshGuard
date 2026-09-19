"use client";

import { useState, useEffect, useRef } from 'react';
import { apiClient } from './api-client';
import type { Device, TelemetryResponse, IncidentListResponse, IncidentDetail } from './api-types';

export function useDashboardData(deviceId: string) {
  const [device, setDevice] = useState<Device | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryResponse | null>(null);
  const [incidents, setIncidents] = useState<IncidentListResponse | null>(null);
  const [activeIncident, setActiveIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(false);

  useEffect(() => {
    if (!deviceId) return;

    mountedRef.current = true;
    let deviceTimer: ReturnType<typeof setTimeout>;
    let telemetryTimer: ReturnType<typeof setTimeout>;
    let incidentsTimer: ReturnType<typeof setTimeout>;

    const fetchActiveIncident = async (incidentId: string) => {
      try {
        const data = await apiClient.getIncident(incidentId);
        if (mountedRef.current && data) {
          setActiveIncident(data);
        }
      } catch {
        // keep previous if fetch fails
      }
    };

    const fetchDevice = async () => {
      try {
        const data = await apiClient.getDevice(deviceId);
        if (mountedRef.current && data) {
          setDevice(data);
          setError(null);
          if (data.activeIncidentId) {
            fetchActiveIncident(data.activeIncidentId);
          } else {
            setActiveIncident(null);
          }
        }
      } catch {
        if (mountedRef.current) {
          setError('Failed to reach API');
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          deviceTimer = setTimeout(fetchDevice, 2500);
        }
      }
    };

    const fetchTelemetry = async () => {
      try {
        const data = await apiClient.getRecentTelemetry(deviceId);
        if (mountedRef.current && data) {
          setTelemetry(data);
        }
      } catch {
        // retain last good data
      } finally {
        if (mountedRef.current) {
          telemetryTimer = setTimeout(fetchTelemetry, 4000);
        }
      }
    };

    const fetchIncidents = async () => {
      try {
        const data = await apiClient.getRecentIncidents(deviceId);
        if (mountedRef.current && data) {
          setIncidents(data);
        }
      } catch {
        // retain last good data
      } finally {
        if (mountedRef.current) {
          incidentsTimer = setTimeout(fetchIncidents, 4000);
        }
      }
    };

    fetchDevice();
    fetchTelemetry();
    fetchIncidents();

    return () => {
      mountedRef.current = false;
      clearTimeout(deviceTimer);
      clearTimeout(telemetryTimer);
      clearTimeout(incidentsTimer);
    };
  }, [deviceId]);

  return { device, telemetry, incidents, activeIncident, error, loading };
}
