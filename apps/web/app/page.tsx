import { TelemetryChart } from "@/components/telemetry-chart";
import { mockDevice, mockIncidents, mockTelemetry } from "@/lib/mock-data";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
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
        <section className="card section-card">
          <p className="card-label">Active incident</p>
          <h2>{device.activeIncidentId ? "Incident open" : "No active incident"}</h2>
          <p className="empty-copy">
            {device.activeIncidentId
              ? `Incident ${device.activeIncidentId} is active.`
              : "Cold Room 01 is currently in NORMAL monitoring state."}
          </p>
        </section>

        <section className="card section-card">
          <p className="card-label">Recent incidents</p>
          <h2>Incident history</h2>
          {mockIncidents.items.length === 0 ? (
            <p className="empty-copy">No recent incidents in the Day-1 mock data.</p>
          ) : (
            <ul className="incident-list">
              {mockIncidents.items.map((incident) => (
                <li key={incident.incidentId}>{incident.incidentId}</li>
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
