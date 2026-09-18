import { IncidentDetailPanel } from "@/components/incident-detail-panel";
import { TelemetryChart } from "@/components/telemetry-chart";
import { mockActiveIncident, mockDevice, mockIncidents, mockTelemetry } from "@/lib/mock-data";

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
  const device = mockDevice;
  const latest = device.latest;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">FreshGuard · Mock dashboard</p>
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
          <span className="section-meta">Mock data</span>
        </div>

        <TelemetryChart
          items={mockTelemetry.items}
          maxTemperatureC={device.configuration.maxTemperatureC}
        />
      </section>

      <div className="two-column-grid">
        <IncidentDetailPanel
          activeIncidentId={device.activeIncidentId}
          incident={mockActiveIncident}
        />

        <section className="card section-card">
          <div className="incident-panel-heading">
            <div>
              <p className="card-label">Recent incidents</p>
              <h2>Incident history</h2>
            </div>
            <span className="section-meta">
              {mockIncidents.items.length} {mockIncidents.items.length === 1 ? "incident" : "incidents"}
            </span>
          </div>

          {mockIncidents.items.length === 0 ? (
            <div className="incident-empty-state">
              <span className="incident-status-badge incident-status-clear">CLEAR</span>
              <p className="empty-copy">No recent incidents in the Day-1 mock data.</p>
            </div>
          ) : (
            <ul className="incident-list" aria-label="Recent incident history">
              {mockIncidents.items.map((incident) => (
                <li className="incident-list-item" key={incident.incidentId}>
                  <div className="incident-list-heading">
                    <span className="incident-id">{incident.incidentId}</span>
                    <div className="incident-badges">
                      <span className={`incident-status-badge incident-status-${incident.status.toLowerCase()}`}>
                        {incident.status}
                      </span>
                      <span className={`ai-status-badge ai-status-${incident.aiStatus.toLowerCase()}`}>
                        AI {incident.aiStatus}
                      </span>
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
