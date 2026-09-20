"use client";

import { AiStatusBadge } from "@/components/dashboard-ui";
import type { IncidentDetail } from "@/lib/api-types";

type AiEnrichmentPanelProps = {
  incident: IncidentDetail;
};

function PendingState() {
  return (
    <div className="ai-generating-row" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <p className="ai-generating-copy">
        Enrichment is queued. Incident evidence remains available.
      </p>
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="ai-generating-row" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <p className="ai-generating-copy">
        Preparing an explanation from the observed incident evidence…
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
    <aside className="incident-detail-section ai-explanation-panel" aria-label="Optional AI enrichment">
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
        <p className="empty-copy">The explanation text is not available yet. Incident evidence remains available.</p>
      ) : (
        <p className="empty-copy ai-pending-copy">
          AI enrichment has not been returned for this incident yet.
        </p>
      )}
    </aside>
  );
}
