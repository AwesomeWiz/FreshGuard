"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardView } from "@/components/dashboard-view";
import {
  FreshGuardApiError,
  getDevice,
  getIncident,
  getRecentIncidents,
  getRecentTelemetry,
} from "@/lib/api-client";
import type {
  Device,
  IncidentDetail,
  IncidentSummary,
  TelemetrySample,
} from "@/lib/api-types";

const DEVICE_POLL_MS = 2500;
const TELEMETRY_POLL_MS = 4000;
const INCIDENTS_POLL_MS = 4000;

const DEMO_DEVICE_ID = process.env.NEXT_PUBLIC_DEMO_DEVICE_ID?.trim() || "cold-room-01";

function userMessage(error: unknown): string {
  if (error instanceof FreshGuardApiError) {
    return error.message;
  }

  return "FreshGuard data is temporarily unavailable.";
}

export function LiveDashboard() {
  const [device, setDevice] = useState<Device | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySample[]>([]);
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [activeIncident, setActiveIncident] = useState<IncidentDetail | null>(null);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [telemetryLoaded, setTelemetryLoaded] = useState(false);
  const [incidentsLoaded, setIncidentsLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retryToken, setRetryToken] = useState(0);

  const setDomainError = useCallback((domain: string, error: unknown) => {
    setErrors((current) => ({ ...current, [domain]: userMessage(error) }));
  }, []);

  const clearDomainError = useCallback((domain: string) => {
    setErrors((current) => {
      if (!(domain in current)) {
        return current;
      }
      const next = { ...current };
      delete next[domain];
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const nextDevice = await getDevice(DEMO_DEVICE_ID, controller.signal);
        if (stopped) return;

        setDevice(nextDevice);
        setDeviceLoaded(true);
        clearDomainError("device");

        if (nextDevice.activeIncidentId) {
          try {
            const detail = await getIncident(nextDevice.activeIncidentId, controller.signal);
            if (!stopped) {
              setActiveIncident(detail);
              clearDomainError("incident-detail");
            }
          } catch (error) {
            if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
              setActiveIncident((current) =>
                current?.incidentId === nextDevice.activeIncidentId ? current : null,
              );
              setDomainError("incident-detail", error);
            }
          }
        } else {
          setActiveIncident(null);
          clearDomainError("incident-detail");
        }
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
          setDeviceLoaded(true);
          setDomainError("device", error);
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, DEVICE_POLL_MS);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [clearDomainError, retryToken, setDomainError]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const response = await getRecentTelemetry(DEMO_DEVICE_ID, controller.signal);
        if (!stopped) {
          setTelemetry(response.items);
          setTelemetryLoaded(true);
          clearDomainError("telemetry");
        }
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
          setTelemetryLoaded(true);
          setDomainError("telemetry", error);
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, TELEMETRY_POLL_MS);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [clearDomainError, retryToken, setDomainError]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const response = await getRecentIncidents(DEMO_DEVICE_ID, controller.signal);
        if (!stopped) {
          setIncidents(response.items);
          setIncidentsLoaded(true);
          clearDomainError("incidents");
        }
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
          setIncidentsLoaded(true);
          setDomainError("incidents", error);
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, INCIDENTS_POLL_MS);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [clearDomainError, retryToken, setDomainError]);

  const errorMessages = useMemo(() => Array.from(new Set(Object.values(errors))), [errors]);
  return (
    <DashboardView
      device={device}
      deviceId={DEMO_DEVICE_ID}
      telemetry={telemetry}
      incidents={incidents}
      activeIncident={activeIncident}
      deviceLoaded={deviceLoaded}
      telemetryLoaded={telemetryLoaded}
      incidentsLoaded={incidentsLoaded}
      errors={errors}
      errorMessages={errorMessages}
      onRetry={() => setRetryToken((value) => value + 1)}
    />
  );
}
