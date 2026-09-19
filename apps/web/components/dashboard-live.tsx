"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { IncidentDetailPanel } from "@/components/incident-detail-panel";
import { TelemetryChart } from "@/components/telemetry-chart";
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "Ongoing";
  }

  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function stateLabel(device: Device): string {
  switch (device.monitoringState) {
    case "NORMAL":
      return "Healthy";
    case "WATCHING":
      return "Watching";
    case "ACTIVE":
      return "Incident";
    case "RECOVERING":
      return "Recovering";
  }
}

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
  const initialLoading = !deviceLoaded || !telemetryLoaded || !incidentsLoaded;

  if (!device && !deviceLoaded) {
    return (
      <main className="page-shell">
        <section className="card section-card dashboard-loading" aria-live="polite">
          <p className="card-label">FreshGuard dashboard</p>
          <h1>Loading Cold Room 01…</h1>
          <p className="empty-copy">Connecting to the FreshGuard read API.</p>
        </section>
      </main>
    );
  }

  if (!device) {
    return (
      <main className="page-shell">
        <section className="card section-card dashboard-loading">
          <p className="card-label">FreshGuard dashboard</p>
          <h1>Cold Room 01 unavailable</h1>
          <p className="empty-copy">{errors.device ?? "Device data could not be loaded."}</p>
          <button className="retry-button" type="button" onClick={() => setRetryToken((value) => value + 1)}>
            Retry now
          </button>
        </section>
      </main>
    );
  }

  const latest = device.latest;
  const recovering = device.monitoringState === "RECOVERING" && device.activeIncidentId !== null;

  // Stale: last-seen is older than the device's configured staleAfterSeconds
  const staleAfterMs = (device.configuration.staleAfterSeconds ?? 30) * 1000;
  const isStale =
    Date.now() - new Date(latest.observedAt).getTime() > staleAfterMs;

  return (
    <main className="page-shell">
      {errorMessages.length > 0 ? (
        <div className="api-error-banner" role="status">
          <div>
            <strong>Live data refresh issue</strong>
            <span>{errorMessages.join(" ")} Last successful values are kept where available.</span>
          </div>
          <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Retry</button>
        </div>
      ) : null}

      <header className="page-header">
        <div>
          <p className="eyebrow">FreshGuard · Live dashboard</p>
          <h1>{device.displayName}</h1>
          <p className="device-id">{device.deviceId}</p>
          {initialLoading ? <p className="section-meta">Loading remaining live data…</p> : null}
        </div>
        <div className={`state-badge state-${device.monitoringState.toLowerCase()}`}>
          <span>{stateLabel(device)}</span>
          <strong>{device.monitoringState}</strong>
        </div>
      </header>

      {recovering ? (
        <div className="recovery-banner" role="status">
          <strong>Recovery in progress</strong>
          <span>The active incident remains open until the backend recovery grace period completes.</span>
        </div>
      ) : null}

      {isStale && !recovering ? (
        <div className="stale-banner" role="status">
          <strong>STALE</strong>
          <span>
            No telemetry received in the last {device.configuration.staleAfterSeconds}s. Device may be
            offline. Monitoring state is determined by the backend only.
          </span>
        </div>
      ) : null}

      <section className="metrics-grid" aria-label="Current device telemetry">
        <article className="card metric-card">
          <p className="card-label">Current temperature</p>
          <p className="metric-value">{latest.temperatureC.toFixed(1)}°C</p>
          <p className="card-note">Configured maximum: {device.configuration.maxTemperatureC}°C</p>
        </article>

        {latest.humidityPct !== undefined ? (
          <article className="card metric-card">
            <p className="card-label">Humidity</p>
            <p className="metric-value metric-text">{latest.humidityPct.toFixed(0)}%</p>
            <p className="card-note">Latest reported value</p>
          </article>
        ) : null}

        <article className="card metric-card">
          <p className="card-label">Door state</p>
          <p className="metric-value metric-text">{latest.doorState ?? "UNKNOWN"}</p>
          <p className="card-note">Context signal only</p>
        </article>

        <article className="card metric-card">
          <p className="card-label">Power state</p>
          <p className="metric-value metric-text">{latest.powerState ?? "UNKNOWN"}</p>
          <p className="card-note">Context signal only</p>
        </article>

        <article className="card metric-card">
          <p className="card-label">Last seen</p>
          <p className="metric-value metric-time">{formatTimestamp(latest.observedAt)}</p>
          <p className="card-note">UTC</p>
        </article>
      </section>

      <section className="card section-card">
        <div className="section-heading">
          <div>
            <p className="card-label">Recent telemetry</p>
            <h2>Temperature readings</h2>
          </div>
          <span className="section-meta">Last 30 minutes · live</span>
        </div>

        {!telemetryLoaded ? (
          <p className="empty-copy">Loading telemetry…</p>
        ) : telemetry.length === 0 ? (
          <p className="empty-copy">No telemetry has been returned for this period.</p>
        ) : (
          <TelemetryChart items={telemetry} maxTemperatureC={device.configuration.maxTemperatureC} />
        )}
      </section>

      <div className="two-column-grid">
        <IncidentDetailPanel
          activeIncidentId={device.activeIncidentId}
          incident={activeIncident}
          fallbackThresholdC={device.configuration.maxTemperatureC}
        />

        <section className="card section-card">
          <div className="incident-panel-heading">
            <div>
              <p className="card-label">Recent incidents</p>
              <h2>Incident history</h2>
            </div>
            <span className="section-meta">
              {incidents.length} {incidents.length === 1 ? "incident" : "incidents"}
            </span>
          </div>

          {!incidentsLoaded ? (
            <p className="empty-copy">Loading incident history…</p>
          ) : incidents.length === 0 ? (
            <div className="incident-empty-state">
              <span className="incident-status-badge incident-status-clear">CLEAR</span>
              <p className="empty-copy">No recent incidents.</p>
            </div>
          ) : (
            <ul className="incident-list" aria-label="Recent incident history">
              {incidents.map((incident) => (
                <li className="incident-list-item" key={incident.incidentId}>
                  <div className="incident-list-heading">
                    <span className="incident-id">{incident.incidentId}</span>
                    <div className="incident-badges">
                      <span className={`incident-status-badge incident-status-${incident.status.toLowerCase()}`}>
                        {incident.status}
                      </span>
                      {incident.aiStatus ? (
                        <span className={`ai-status-badge ai-status-${incident.aiStatus.toLowerCase()}`}>
                          AI {incident.aiStatus}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <dl className="incident-detail-grid incident-history-details">
                    <div><dt>Opened</dt><dd>{formatTimestamp(incident.openedAt)}</dd></div>
                    <div><dt>Resolved</dt><dd>{incident.resolvedAt ? formatTimestamp(incident.resolvedAt) : "—"}</dd></div>
                    <div><dt>Peak</dt><dd>{incident.peakTemperatureC.toFixed(1)}°C</dd></div>
                    <div><dt>Duration</dt><dd>{formatDuration(incident.durationSeconds)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card config-card">
        <p className="card-label">Demo configuration</p>
        <dl className="config-grid">
          <div><dt>Maximum temperature</dt><dd>{device.configuration.maxTemperatureC}°C</dd></div>
          <div><dt>Breach grace</dt><dd>{device.configuration.breachGraceSeconds}s</dd></div>
          <div><dt>Recovery grace</dt><dd>{device.configuration.recoveryGraceSeconds}s</dd></div>
          <div><dt>Stale after</dt><dd>{device.configuration.staleAfterSeconds}s</dd></div>
        </dl>
      </section>
    </main>
  );
}
