"use client";

import { useEffect, useState } from "react";

import type { IncidentDetailResponse } from "@/lib/mock-data";

type IncidentDetailPanelProps = {
  activeIncidentId: string | null;
  incident: IncidentDetailResponse | null;
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "Updating…";
  }

  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function IncidentDetailPanel({ activeIncidentId, incident }: IncidentDetailPanelProps) {
  const [liveDurationSeconds, setLiveDurationSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!incident || incident.status !== "OPEN" || incident.durationSeconds !== null) {
      setLiveDurationSeconds(null);
      return;
    }

    const openedAtMs = new Date(incident.openedAt).getTime();
    if (!Number.isFinite(openedAtMs)) {
      return;
    }

    const updateDuration = () => {
      setLiveDurationSeconds(Math.max(0, Math.floor((Date.now() - openedAtMs) / 1000)));
    };

    updateDuration();
    const timer = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(timer);
  }, [incident]);

  if (!activeIncidentId) {
    return (
      <section className="card section-card incident-panel incident-panel-clear incident-live-panel">
        <div className="incident-panel-heading">
          <div>
            <p className="card-label">Live incident detail</p>
            <h2>No active incident</h2>
          </div>
          <span className="incident-status-badge incident-status-clear">CLEAR</span>
        </div>
        <p className="empty-copy">Incident evidence will appear here when Cold Room 01 has an active incident.</p>
      </section>
    );
  }

  if (!incident) {
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
          The device reports an active incident, but its full incident detail record is not present in the current dashboard data.
        </p>
      </section>
    );
  }

  const displayedDuration = incident.durationSeconds ?? liveDurationSeconds;

  return (
    <section
      className={`card section-card incident-panel incident-live-panel ${
        incident.status === "OPEN" ? "incident-panel-open" : "incident-panel-clear"
      }`}
      aria-label={`Incident ${incident.incidentId} detail`}
    >
      <div className="incident-panel-heading">
        <div>
          <p className="card-label">Live incident detail</p>
          <h2>{incident.status === "OPEN" ? "Incident open" : "Incident resolved"}</h2>
        </div>
        <span className={`incident-status-badge incident-status-${incident.status.toLowerCase()}`}>
          {incident.status}
        </span>
      </div>

      <p className="incident-id">{incident.incidentId}</p>

      <div className="incident-live-metrics" aria-label="Incident temperature summary">
        <div>
          <span>Latest</span>
          <strong>{incident.latestTemperatureC.toFixed(1)}°C</strong>
        </div>
        <div>
          <span>Peak</span>
          <strong>{incident.peakTemperatureC.toFixed(1)}°C</strong>
        </div>
        <div>
          <span>Threshold</span>
          <strong>{incident.thresholdC.toFixed(1)}°C</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatDuration(displayedDuration)}</strong>
        </div>
      </div>

      <div className="incident-detail-section">
        <h3>Incident evidence</h3>
        <dl className="incident-detail-grid incident-detail-grid-wide">
          <div><dt>Device</dt><dd>{incident.deviceId}</dd></div>
          <div><dt>Opened</dt><dd>{formatTimestamp(incident.openedAt)}</dd></div>
          <div><dt>Breach started</dt><dd>{formatTimestamp(incident.breachStartedAt)}</dd></div>
          <div><dt>Resolved</dt><dd>{formatTimestamp(incident.resolvedAt)}</dd></div>
          <div><dt>Breach grace</dt><dd>{incident.breachGraceSeconds}s</dd></div>
          <div><dt>Recovery grace</dt><dd>{incident.recoveryGraceSeconds}s</dd></div>
          <div><dt>Temperature at open</dt><dd>{incident.temperatureAtOpenC.toFixed(1)}°C</dd></div>
          <div><dt>Door at open</dt><dd>{incident.doorStateAtOpen}</dd></div>
          <div><dt>Power at open</dt><dd>{incident.powerStateAtOpen}</dd></div>
        </dl>
      </div>

      <div className="incident-detail-section incident-delivery-section">
        <h3>Delivery status</h3>
        <dl className="incident-detail-grid">
          <div>
            <dt>Notification</dt>
            <dd><span className="system-status-badge">{incident.notificationStatus}</span></dd>
          </div>
          <div><dt>Notification sent</dt><dd>{formatTimestamp(incident.notificationSentAt)}</dd></div>
          <div>
            <dt>Incident event</dt>
            <dd><span className="system-status-badge">{incident.eventDispatchStatus}</span></dd>
          </div>
        </dl>
      </div>

      <div className="incident-detail-section ai-explanation-panel">
        <div className="ai-explanation-heading">
          <div>
            <h3>Bedrock explanation</h3>
            <p>AI-generated from observed incident evidence.</p>
          </div>
          <span className={`ai-status-badge ai-status-${incident.aiStatus.toLowerCase()}`}>
            {incident.aiStatus}
          </span>
        </div>

        {incident.aiExplanation ? (
          <p className="ai-explanation-copy">{incident.aiExplanation}</p>
        ) : (
          <p className="empty-copy">
            {incident.aiStatus === "GENERATING"
              ? "Explanation is being generated."
              : incident.aiStatus === "FAILED"
                ? "Explanation generation failed; incident evidence remains available above."
                : "No explanation text is available."}
          </p>
        )}

        {incident.aiGeneratedAt ? (
          <p className="ai-generated-at">Generated {formatTimestamp(incident.aiGeneratedAt)} UTC</p>
        ) : null}
      </div>
    </section>
  );
}
