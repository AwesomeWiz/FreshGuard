import { IncidentDetailPanel } from "@/components/incident-detail-panel";
import { TelemetryChart } from "@/components/telemetry-chart";
import { AiStatusBadge, AppHeader, EmptyState, StatusBadge, Timestamp, type StatusTone } from "@/components/dashboard-ui";
import type { Device, IncidentDetail, IncidentSummary, TelemetrySample } from "@/lib/api-types";

type DashboardViewProps = {
  device: Device | null;
  deviceId: string;
  telemetry: TelemetrySample[];
  incidents: IncidentSummary[];
  activeIncident: IncidentDetail | null;
  deviceLoaded: boolean;
  telemetryLoaded: boolean;
  incidentsLoaded: boolean;
  errors: Record<string, string>;
  errorMessages: string[];
  onRetry: () => void;
};

const states: Record<Device["monitoringState"], { label: string; tone: StatusTone; description: string }> = {
  NORMAL: { label: "Healthy", tone: "healthy", description: "No sustained temperature breach." },
  WATCHING: { label: "Watching", tone: "watching", description: "Temperature breach under observation." },
  ACTIVE: { label: "Incident", tone: "incident", description: "An incident is open. Review the evidence below." },
  RECOVERING: { label: "Recovering", tone: "recovering", description: "Recovery is being observed. The incident remains open." },
};

function formatDuration(value: number | null): string {
  if (value === null) return "Ongoing";
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function DashboardView({ device, deviceId, telemetry, incidents, activeIncident, deviceLoaded, telemetryLoaded, incidentsLoaded, errors, errorMessages, onRetry }: DashboardViewProps) {
  if (!device) {
    return (
      <>
        <AppHeader deviceId={deviceId} />
        <main className="page-shell">
          <section className="card section-card dashboard-loading">
            <p className="eyebrow">Device overview</p>
            <h1>{deviceLoaded ? "Device unavailable" : "Connecting to your cold room"}</h1>
            <EmptyState title={deviceLoaded ? "Unable to load device" : "Loading live data"} loading={!deviceLoaded}>
              {deviceLoaded ? errors.device ?? "Device data could not be loaded." : "Your latest readings and incident evidence will appear here."}
            </EmptyState>
            {deviceLoaded ? <button className="retry-button" type="button" onClick={onRetry}>Retry now</button> : null}
          </section>
        </main>
      </>
    );
  }

  const latest = device.latest;
  const recovering = device.monitoringState === "RECOVERING" && device.activeIncidentId !== null;
  const staleAfterMs = (device.configuration.staleAfterSeconds ?? 30) * 1000;
  const isStale = Date.now() - new Date(latest.observedAt).getTime() > staleAfterMs;
  const state = states[device.monitoringState];
  const initialLoading = !deviceLoaded || !telemetryLoaded || !incidentsLoaded;

  return (
    <>
      <a className="skip-link" href="#dashboard">Skip to dashboard</a>
      <AppHeader deviceId={device.deviceId}>
        <StatusBadge tone={isStale || errors.device ? "neutral" : "healthy"}>
          {errors.device ? "Refresh issue" : isStale ? "Telemetry stale" : "Live telemetry"}
        </StatusBadge>
      </AppHeader>
      <main id="dashboard" className="page-shell" tabIndex={-1}>
        <header className="page-header">
          <div>
            <p className="eyebrow">Operations / Device overview</p>
            <h1>{device.displayName}</h1>
            <p className="page-description">Live conditions, incident evidence, and recovery at a glance.</p>
          </div>
          <div className="page-header-meta">
            <span className="section-meta">Automatic refresh</span>
            <span className="section-meta">{initialLoading ? "Loading remaining data…" : "All times in UTC"}</span>
          </div>
        </header>

        {errorMessages.length > 0 ? (
          <div className="notice api-error-banner" role="status">
            <div><strong>Live data refresh issue</strong><p>{errorMessages.join(" ")} Last successful values are kept where available.</p></div>
            <button className="retry-button" type="button" onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        {isStale ? (
          <div className="notice stale-banner" role="status">
            <span className="notice-symbol" aria-hidden="true">!</span>
            <div><strong>Telemetry is stale</strong><p>No reading in the last {device.configuration.staleAfterSeconds}s. The device may be offline. Values below are the last reported readings.</p></div>
          </div>
        ) : null}
        {recovering ? (
          <div className="notice recovery-banner" role="status">
            <span className="notice-symbol" aria-hidden="true">↘</span>
            <div><strong>Recovery in progress</strong><p>The incident remains open until the {device.configuration.recoveryGraceSeconds}s recovery grace period completes.</p></div>
          </div>
        ) : null}

        <section className="overview-grid" aria-label="Current device telemetry">
          <article className="card temperature-card">
            <p className="card-label">{isStale ? "Last reported temperature" : "Current temperature"}</p>
            <p className="temperature-value">{latest.temperatureC.toFixed(1)}<span>°C</span></p>
            <p className="card-note"><span className="threshold-key" aria-hidden="true" />Maximum {device.configuration.maxTemperatureC}°C</p>
          </article>
          <article className={`card monitoring-card tone-${state.tone}`}>
            <p className="card-label">Monitoring state</p>
            <p className="monitoring-value"><span className="status-dot" aria-hidden="true" />{state.label}</p>
            <p className="card-note">{state.description}</p>
            <span className="monitoring-footnote">{device.activeIncidentId ? "Active incident on this device" : "No active incident"}</span>
          </article>
          <article className="card context-card">
            <dl className="context-grid">
              <div className="last-seen"><dt>Last seen</dt><dd><Timestamp value={latest.observedAt} /></dd></div>
              <div><dt>Humidity</dt><dd>{latest.humidityPct !== undefined ? <>{latest.humidityPct.toFixed(0)}<span className="metric-unit">%</span></> : "Not reported"}</dd></div>
              <div><dt>Door</dt><dd className="context-value">{latest.doorState?.toLowerCase() ?? "Unknown"}</dd></div>
              <div><dt>Power</dt><dd className="context-value">{latest.powerState?.toLowerCase() ?? "Unknown"}</dd></div>
            </dl>
          </article>
        </section>

        <section className="card section-card telemetry-section" aria-labelledby="telemetry-title">
          <div className="section-heading">
            <div><p className="card-label">Telemetry</p><h2 id="telemetry-title">Temperature over time</h2></div>
            <span className="window-label">Last 30 minutes <span className="muted">/ UTC</span></span>
          </div>
          {!telemetryLoaded ? (
            <EmptyState title="Loading telemetry" loading>Fetching recent temperature readings.</EmptyState>
          ) : telemetry.length === 0 ? (
            <EmptyState title={errors.telemetry ? "Telemetry unavailable" : "No readings in this window"}>
              {errors.telemetry ? "Readings will appear when the connection is restored." : "Recent temperature readings will appear here as they arrive."}
            </EmptyState>
          ) : <TelemetryChart items={telemetry} maxTemperatureC={device.configuration.maxTemperatureC} />}
        </section>

        <IncidentDetailPanel activeIncidentId={device.activeIncidentId} incident={activeIncident} fallbackThresholdC={device.configuration.maxTemperatureC} />

        <section className="card section-card history-section" aria-labelledby="history-title">
          <div className="section-heading">
            <div><p className="card-label">Activity log</p><h2 id="history-title">Incident history</h2></div>
            <span className="section-meta">{incidents.length} recent {incidents.length === 1 ? "incident" : "incidents"}</span>
          </div>
          {!incidentsLoaded ? (
            <EmptyState title="Loading incident history" loading>Fetching recent incidents for this device.</EmptyState>
          ) : incidents.length === 0 ? (
            <EmptyState title={errors.incidents ? "History unavailable" : "No recent incidents"}>
              {errors.incidents ? "History will appear when the connection is restored." : "Recorded incidents and their outcomes will appear here."}
            </EmptyState>
          ) : (
            <div className="history-table-scroll" role="region" aria-label="Recent incident history, scroll horizontally for more columns" tabIndex={0}>
              <table className="history-table">
                <caption className="sr-only">Recent incidents. All dates and times are UTC.</caption>
                <thead><tr><th scope="col">Incident</th><th scope="col">Status</th><th scope="col">Opened</th><th scope="col">Resolved</th><th scope="col">Duration</th><th scope="col">Peak</th><th scope="col">AI enrichment</th></tr></thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr key={incident.incidentId}>
                      <th scope="row"><span className="incident-id history-id" tabIndex={0} title={incident.incidentId}>{incident.incidentId}</span></th>
                      <td><StatusBadge tone={incident.status === "OPEN" ? "incident" : "neutral"}>{incident.status === "OPEN" ? "Open" : "Resolved"}</StatusBadge></td>
                      <td><Timestamp value={incident.openedAt} /></td>
                      <td>{incident.resolvedAt ? <Timestamp value={incident.resolvedAt} /> : <span className="muted">Ongoing</span>}</td>
                      <td className="tabular">{formatDuration(incident.durationSeconds)}</td>
                      <td className="table-peak">{incident.peakTemperatureC.toFixed(1)}°C</td>
                      <td><AiStatusBadge status={incident.aiStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="config-card" aria-labelledby="config-title">
          <h2 id="config-title">Demo configuration</h2>
          <dl className="config-grid">
            <div><dt>Maximum temperature</dt><dd>{device.configuration.maxTemperatureC}°C</dd></div>
            <div><dt>Breach grace</dt><dd>{device.configuration.breachGraceSeconds}s</dd></div>
            <div><dt>Recovery grace</dt><dd>{device.configuration.recoveryGraceSeconds}s</dd></div>
            <div><dt>Stale after</dt><dd>{device.configuration.staleAfterSeconds}s</dd></div>
          </dl>
        </section>
        <footer className="page-footer"><span>FreshGuard · Cold-chain monitoring</span><span>Telemetry is the source of truth.</span></footer>
      </main>
    </>
  );
}
