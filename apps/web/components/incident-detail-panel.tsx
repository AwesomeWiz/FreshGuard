"use client";

import { useEffect, useState } from "react";

import { AiEnrichmentPanel } from "@/components/ai-enrichment-panel";
import type { IncidentDetail } from "@/lib/api-types";

type IncidentDetailPanelProps = {
  activeIncidentId: string | null;
  incident: IncidentDetail | null;
  /** Fallback threshold from device config if incident doesn't return thresholdC */
  fallbackThresholdC?: number;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) return "Updating…";
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatTemperature(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)}°C`;
}

// ---------------------------------------------------------------------------
// Clear (no incident) state
// ---------------------------------------------------------------------------
function ClearPanel() {
  return (
    <section className="card section-card incident-panel incident-panel-clear incident-live-panel">
      <div className="incident-panel-heading">
        <div>
          <p className="card-label">Live incident detail</p>
          <h2>No active incident</h2>
        </div>
        <span className="incident-status-badge incident-status-clear">CLEAR</span>
      </div>
      <p className="empty-copy">
        Incident evidence will appear here when the backend reports an active incident.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Incident ID known but detail not yet fetched
// ---------------------------------------------------------------------------
function PendingDetailPanel({ activeIncidentId }: { activeIncidentId: string }) {
  return (
    <section className="card section-card incident-panel incident-panel-open incident-live-panel">
      <div className="incident-panel-heading">
        <div>
          <p className="card-label">Live incident detail</p>
          <h2>Incident open</h2>
        </div>
        <span className="incident-status-badge incident-status-open">OPEN</span>
      </div>
      <p className="incident-id">{activeIncidentId}</p>
      <p className="empty-copy incident-detail-message">
        Device reports an active incident. Loading evidence…
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main populated panel
// ---------------------------------------------------------------------------
export function IncidentDetailPanel({
  activeIncidentId,
  incident,
  fallbackThresholdC,
}: IncidentDetailPanelProps) {
  const [liveDurationSeconds, setLiveDurationSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!incident || incident.status !== "OPEN" || incident.durationSeconds !== null) {
      setLiveDurationSeconds(null);
      return;
    }
    const openedAtMs = new Date(incident.openedAt).getTime();
    if (!Number.isFinite(openedAtMs)) return;

    const update = () =>
      setLiveDurationSeconds(Math.max(0, Math.floor((Date.now() - openedAtMs) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [incident]);

  if (!activeIncidentId) return <ClearPanel />;
  if (!incident) return <PendingDetailPanel activeIncidentId={activeIncidentId} />;

  const displayedDuration = incident.durationSeconds ?? liveDurationSeconds;
  const thresholdC = incident.thresholdC ?? fallbackThresholdC;
  const isOpen = incident.status === "OPEN";

  return (
    <section
      className={`card section-card incident-panel incident-live-panel ${
        isOpen ? "incident-panel-open" : "incident-panel-clear"
      }`}
      aria-label={`Incident ${incident.incidentId} detail`}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="incident-panel-heading">
        <div>
          <p className="card-label">Live incident detail</p>
          <h2>{isOpen ? "Incident open" : "Incident resolved"}</h2>
        </div>
        <span className={`incident-status-badge incident-status-${incident.status.toLowerCase()}`}>
          {incident.status}
        </span>
      </div>

      <p className="incident-id">{incident.incidentId}</p>

      {/* ── Quick-read metrics ──────────────────────────────────────────── */}
      <div className="incident-live-metrics" aria-label="Incident temperature summary">
        <div>
          <span>Latest</span>
          <strong>{formatTemperature(incident.latestTemperatureC)}</strong>
        </div>
        <div>
          <span>Peak</span>
          <strong>{incident.peakTemperatureC.toFixed(1)}°C</strong>
        </div>
        <div>
          <span>Threshold</span>
          <strong>{formatTemperature(thresholdC)}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatDuration(displayedDuration)}</strong>
        </div>
      </div>

      {/* ── 1. Deterministic evidence ───────────────────────────────────── */}
      <div className="incident-detail-section">
        <h3>Incident evidence</h3>
        <dl className="incident-detail-grid incident-detail-grid-wide">
          <div><dt>Device</dt><dd>{incident.deviceId}</dd></div>
          <div><dt>Opened</dt><dd>{formatTimestamp(incident.openedAt)}</dd></div>
          <div><dt>Breach started</dt><dd>{formatTimestamp(incident.breachStartedAt)}</dd></div>
          <div><dt>Resolved</dt><dd>{formatTimestamp(incident.resolvedAt)}</dd></div>
          <div>
            <dt>Breach grace</dt>
            <dd>{incident.breachGraceSeconds === undefined ? "—" : `${incident.breachGraceSeconds}s`}</dd>
          </div>
          <div>
            <dt>Recovery grace</dt>
            <dd>{incident.recoveryGraceSeconds === undefined ? "—" : `${incident.recoveryGraceSeconds}s`}</dd>
          </div>
          <div><dt>Temperature at open</dt><dd>{formatTemperature(incident.temperatureAtOpenC)}</dd></div>
          <div><dt>Door at open</dt><dd>{incident.doorStateAtOpen ?? "—"}</dd></div>
          <div><dt>Power at open</dt><dd>{incident.powerStateAtOpen ?? "—"}</dd></div>
        </dl>
      </div>

      {/* ── 2. Delivery / SNS status ────────────────────────────────────── */}
      <div className="incident-detail-section incident-delivery-section">
        <h3>Alert delivery</h3>
        <dl className="incident-detail-grid">
          <div>
            <dt>Notification</dt>
            <dd>
              <span className="system-status-badge">
                {incident.notificationStatus ?? "Not returned"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Notification sent</dt>
            <dd>{formatTimestamp(incident.notificationSentAt ?? null)}</dd>
          </div>
          {incident.eventDispatchStatus ? (
            <div>
              <dt>Event dispatch</dt>
              <dd>
                <span className="system-status-badge">{incident.eventDispatchStatus}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* ── 3. AI enrichment — always last, clearly secondary ───────────── */}
      <AiEnrichmentPanel incident={incident} />
    </section>
  );
}
