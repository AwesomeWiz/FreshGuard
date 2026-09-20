"use client";

import type { AiStatus, IncidentDetail } from "@/lib/api-types";

type AiEnrichmentPanelProps = {
  incident: IncidentDetail;
};

function AiStatusBadge({ status }: { status: AiStatus | undefined }) {
  if (!status) return null;
  // PENDING renders with the same amber style as GENERATING
  const cssStatus = status === "PENDING" ? "generating" : status.toLowerCase();
  return (
    <span
      className={`ai-status-badge ai-status-${cssStatus}`}
      aria-label={`AI status: ${status}`}
    >
      {status}
    </span>
  );
}

function PendingState() {
  return (
    <div className="ai-generating-row" aria-live="polite">
      <span className="ai-generating-dot" aria-hidden="true" />
      <p className="ai-generating-copy">
        AI enrichment queued. This does not affect incident evidence above.
      </p>
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="ai-generating-row" aria-live="polite">
      <span className="ai-generating-dot" aria-hidden="true" />
      <p className="ai-generating-copy">
        AI explanation generating… This does not affect incident evidence above.
      </p>
    </div>
  );
}

function FailedState() {
  return (
    <p className="ai-failed-copy">
      AI explanation unavailable.
    </p>
  );
}

function ReadyState({
  explanation,
  generatedAt,
}: {
  explanation: string;
  generatedAt: string | null | undefined;
}) {
  const formatted = generatedAt
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(generatedAt))
    : null;

  return (
    <>
      <p className="ai-explanation-copy">{explanation}</p>
      {formatted ? (
        <p className="ai-generated-at">
          Generated {formatted} UTC · AI-generated from observed evidence only
        </p>
      ) : (
        <p className="ai-generated-at">AI-generated from observed incident evidence</p>
      )}
    </>
  );
}

export function AiEnrichmentPanel({ incident }: AiEnrichmentPanelProps) {
  const { aiStatus, aiExplanation, aiGeneratedAt } = incident;

  return (
    <div className="incident-detail-section ai-explanation-panel">
      <div className="ai-explanation-heading">
        <div>
          <h3>AI-generated explanation</h3>
          <p className="ai-explanation-subtitle">
            Secondary enrichment only · does not determine incident validity
          </p>
        </div>
        <AiStatusBadge status={aiStatus} />
      </div>

      {aiStatus === "PENDING" ? (
        <PendingState />
      ) : aiStatus === "GENERATING" ? (
        <GeneratingState />
      ) : aiStatus === "FAILED" ? (
        <FailedState />
      ) : aiStatus === "READY" && aiExplanation ? (
        <ReadyState explanation={aiExplanation} generatedAt={aiGeneratedAt} />
      ) : aiStatus === "READY" && !aiExplanation ? (
        <p className="empty-copy">AI status is READY but no explanation text was returned.</p>
      ) : (
        <p className="empty-copy ai-pending-copy">
          AI enrichment has not been returned for this incident yet.
        </p>
      )}
    </div>
  );
}
