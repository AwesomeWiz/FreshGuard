"use client";

import { useEffect, useState } from "react";

import type { IncidentDetail } from "@/lib/api-types";

type IncidentDetailPanelProps = {
  activeIncidentId: string | null;
  incident: IncidentDetail | null;
  fallbackThresholdC?: number;
};

function formatTimestamp(value: string | null | undefined): string {
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

function formatTemperature(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)}°C`;
}

type TimelineItem = {
  key: string;
  label: string;
  timestamp: string;
  detail: string;
};

function buildIncidentTimeline(incident: IncidentDetail, thresholdC?: number): TimelineItem[] {
  const items: TimelineItem[] = [];

  if (incident.breachStartedAt) {
    items.push({
      key: "breach-started",
      label: "Breach started",
      timestamp: incident.breachStartedAt,
      detail: thresholdC === undefined
        ? "Temperature breach detected."
        : `Temperature crossed the ${thresholdC.toFixed(1)}°C threshold.`,
    });
  }

  items.push({
    key: "incident-opened",
    label: "Incident opened",
    timestamp: incident.openedAt,
    detail: [
      incident.temperatureAtOpenC === undefined ? null : `${incident.temperatureAtOpenC.toFixed(1)}°C`,
      incident.doorStateAtOpen ? `Door ${incident.doorStateAtOpen}` : null,
      incident.powerStateAtOpen ? `Power ${incident.powerStateAtOpen}` : null,
    ].filter(Boolean).join(" · ") || "Incident opened after the configured breach grace period.",
  });

  if (incident.notificationSentAt) {
    items.push({
      key: "notification-sent",
      label: "Notification sent",
      timestamp: incident.notificationSentAt,
      detail: incident.notificationStatus
        ? `Notification status: ${incident.notificationStatus}`
        : "Notification timestamp recorded.",
    });
  }

  if (incident.aiGeneratedAt) {
    items.push({
      key: "ai-generated",
      label: "AI enrichment updated",
      timestamp: incident.aiGeneratedAt,
      detail: incident.aiStatus ? `AI status: ${incident.aiStatus}` : "AI enrichment timestamp recorded.",
    });
  }

  if (incident.resolvedAt) {
    items.push({
      key: "incident-resolved",
      label: "Incident resolved",
      timestamp: incident.resolvedAt,
      detail: `Peak ${incident.peakTemperatureC.toFixed(1)}°C · Duration ${formatDuration(incident.durationSeconds)}`,
    });
  }

  return items.sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

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
        <p className="empty-copy">Incident evidence will appear here when the backend reports an active incident.</p>
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
          The device reports an active incident. Waiting for the incident detail endpoint to return its evidence.
        </p>
      </section>
    );
  }

  const displayedDuration = incident.durationSeconds ?? liveDurationSeconds;
  const thresholdC = incident.thresholdC ?? fallbackThresholdC;
  const timeline = buildIncidentTimeline(incident, thresholdC);

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
        <div><span>Latest</span><strong>{formatTemperature(incident.latestTemperatureC)}</strong></div>
        <div><span>Peak</span><strong>{incident.peakTemperatureC.toFixed(1)}°C</strong></div>
        <div><span>Threshold</span><strong>{formatTemperature(thresholdC)}</strong></div>
        <div><span>Duration</span><strong>{formatDuration(displayedDuration)}</strong></div>
      </div>

      <div className="incident-detail-section">
        <h3>Incident evidence</h3>
        <dl className="incident-detail-grid incident-detail-grid-wide">
          <div><dt>Device</dt><dd>{incident.deviceId}</dd></div>
          <div><dt>Opened</dt><dd>{formatTimestamp(incident.openedAt)}</dd></div>
          <div><dt>Breach started</dt><dd>{formatTimestamp(incident.breachStartedAt)}</dd></div>
          <div><dt>Resolved</dt><dd>{formatTimestamp(incident.resolvedAt)}</dd></div>
          <div><dt>Breach grace</dt><dd>{incident.breachGraceSeconds === undefined ? "—" : `${incident.breachGraceSeconds}s`}</dd></div>
          <div><dt>Recovery grace</dt><dd>{incident.recoveryGraceSeconds === undefined ? "—" : `${incident.recoveryGraceSeconds}s`}</dd></div>
          <div><dt>Temperature at open</dt><dd>{formatTemperature(incident.temperatureAtOpenC)}</dd></div>
          <div><dt>Door at open</dt><dd>{incident.doorStateAtOpen ?? "—"}</dd></div>
          <div><dt>Power at open</dt><dd>{incident.powerStateAtOpen ?? "—"}</dd></div>
        </dl>
      </div>

      <div className="incident-detail-section">
        <h3>Incident timeline</h3>
        <ol className="incident-timeline" aria-label="Incident timeline">
          {timeline.map((item) => (
            <li className="incident-timeline-item" key={item.key}>
              <span className="incident-timeline-marker" aria-hidden="true" />
              <div className="incident-timeline-content">
                <div className="incident-timeline-heading">
                  <strong>{item.label}</strong>
                  <time dateTime={item.timestamp}>{formatTimestamp(item.timestamp)} UTC</time>
                </div>
                <p>{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="incident-detail-section incident-delivery-section">
        <h3>Delivery status</h3>
        <dl className="incident-detail-grid">
          <div>
            <dt>Notification</dt>
            <dd><span className="system-status-badge">{incident.notificationStatus ?? "Not returned"}</span></dd>
          </div>
          <div><dt>Notification sent</dt><dd>{formatTimestamp(incident.notificationSentAt)}</dd></div>
          <div>
            <dt>Incident event</dt>
            <dd><span className="system-status-badge">{incident.eventDispatchStatus ?? "Not returned"}</span></dd>
          </div>
        </dl>
      </div>

      <div className="incident-detail-section ai-explanation-panel">
        <div className="ai-explanation-heading">
          <div>
            <h3>AI enrichment</h3>
            <p>Shown only when the incident endpoint returns enrichment fields.</p>
          </div>
          {incident.aiStatus ? (
            <span className={`ai-status-badge ai-status-${incident.aiStatus.toLowerCase()}`}>
              {incident.aiStatus}
            </span>
          ) : null}
        </div>

        {incident.aiExplanation ? (
          <p className="ai-explanation-copy">{incident.aiExplanation}</p>
        ) : (
          <p className="empty-copy">
            {incident.aiStatus === "GENERATING"
              ? "Explanation is being generated."
              : incident.aiStatus === "FAILED"
                ? "Explanation generation failed; incident evidence remains available above."
                : "No AI explanation has been returned."}
          </p>
        )}

        {incident.aiGeneratedAt ? (
          <p className="ai-generated-at">Generated {formatTimestamp(incident.aiGeneratedAt)} UTC</p>
        ) : null}
      </div>
    </section>
  );
}
