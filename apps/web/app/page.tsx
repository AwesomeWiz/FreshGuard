"use client";

import { IncidentDetailPanel } from "@/components/incident-detail-panel";
import { TelemetryChart } from "@/components/telemetry-chart";
import { useDashboardData } from "@/lib/use-dashboard-data";
import { useEffect, useState } from "react";

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

export default function HomePage() {
  const [deviceId, setDeviceId] = useState<string>("cold-room-01");
  
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_DEVICE_ID) {
      setDeviceId(process.env.NEXT_PUBLIC_DEMO_DEVICE_ID);
    }
  }, []);

  const { device, telemetry, incidents, activeIncident, error, loading } = useDashboardData(deviceId);

  if (loading) {
    return (
      <main className="page-shell">
        <div className="empty-copy" style={{ padding: "40px" }}>Loading dashboard data...</div>
      </main>
    );
  }

  if (error && !device) {
    return (
      <main className="page-shell">
        <div className="incident-status-badge incident-status-open" style={{ padding: "10px", margin: "20px 0" }}>
          API Unavailable: {error}. Retrying...
        </div>
      </main>
    );
  }

  if (!device) return null;

  const latest = device.latest;

  return (
    <main className="page-shell">
      {error && (
        <div className="incident-status-badge incident-status-open" style={{ padding: "10px", marginBottom: "20px" }}>
          Warning: API temporarily unavailable. Showing last known state.
        </div>
      )}
      
      <header className="page-header">
        <div>
          <p className="eyebrow">FreshGuard · Live dashboard</p>
          <h1>{device.displayName}</h1>
          <p className="device-id">{device.deviceId}</p>
        </div>
        <div className={`state-badge state-${device.monitoringState.toLowerCase()}`}>
          <span>State</span>
          <strong>{device.monitoringState}</strong>
        </div>
      </header>

      <section className="metrics-grid" aria-label="Current device telemetry">
        <article className="card metric-card">
          <p className="card-label">Current temperature</p>
          <p className="metric-value">{latest.temperatureC.toFixed(1)}°C</p>
          <p className="card-note">Configured maximum: {device.configuration.maxTemperatureC}°C</p>
        </article>

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
          <span className="section-meta">Live data</span>
        </div>

        {telemetry ? (
          <TelemetryChart
            items={telemetry.items}
            maxTemperatureC={device.configuration.maxTemperatureC}
          />
        ) : (
          <div className="empty-copy">No telemetry available</div>
        )}
      </section>

      <div className="two-column-grid">
        <IncidentDetailPanel
          activeIncidentId={device.activeIncidentId}
          incident={activeIncident}
        />

        <section className="card section-card">
          <div className="incident-panel-heading">
            <div>
              <p className="card-label">Recent incidents</p>
              <h2>Incident history</h2>
            </div>
            <span className="section-meta">
              {incidents ? incidents.items.length : 0} {incidents?.items.length === 1 ? "incident" : "incidents"}
            </span>
          </div>

          {!incidents || incidents.items.length === 0 ? (
            <div className="incident-empty-state">
              <span className="incident-status-badge incident-status-clear">CLEAR</span>
              <p className="empty-copy">No recent incidents recorded.</p>
            </div>
          ) : (
            <ul className="incident-list" aria-label="Recent incident history">
              {incidents.items.map((incident) => (
                <li className="incident-list-item" key={incident.incidentId}>
                  <div className="incident-list-heading">
                    <span className="incident-id">{incident.incidentId}</span>
                    <div className="incident-badges">
                      <span className={`incident-status-badge incident-status-${incident.status.toLowerCase()}`}>
                        {incident.status}
                      </span>
                      {incident.aiStatus && (
                        <span className={`ai-status-badge ai-status-${incident.aiStatus.toLowerCase()}`}>
                          AI {incident.aiStatus}
                        </span>
                      )}
                    </div>
                  </div>

                  <dl className="incident-detail-grid incident-history-details">
                    <div>
                      <dt>Opened</dt>
                      <dd>{formatTimestamp(incident.openedAt)}</dd>
                    </div>
                    <div>
                      <dt>Resolved</dt>
                      <dd>{incident.resolvedAt ? formatTimestamp(incident.resolvedAt) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Peak</dt>
                      <dd>{incident.peakTemperatureC.toFixed(1)}°C</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatDuration(incident.durationSeconds)}</dd>
                    </div>
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
