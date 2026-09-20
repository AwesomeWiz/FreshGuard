import type { ReactNode } from "react";
import type { AiStatus } from "@/lib/api-types";

export type StatusTone = "healthy" | "watching" | "incident" | "recovering" | "neutral";

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`status-badge tone-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

const aiLabels: Record<AiStatus, string> = {
  PENDING: "Queued",
  GENERATING: "Generating",
  READY: "Ready",
  FAILED: "Unavailable",
};

export function AiStatusBadge({ status }: { status: AiStatus | undefined }) {
  return status ? (
    <span className={`ai-status-badge ai-status-${status.toLowerCase()}`} aria-label={`AI status: ${status}`}>
      {aiLabels[status]}
    </span>
  ) : <span className="muted">Not available</span>;
}

export function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  const date = new Date(value);
  return (
    <time className="timestamp" dateTime={value} title={value}>
      <span>{new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(date)} <span className="time-zone">UTC</span></span>
      <span className="timestamp-date">{new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)}</span>
    </time>
  );
}

export function EmptyState({ title, children, loading = false }: { title: string; children: ReactNode; loading?: boolean }) {
  return (
    <div className={`empty-state${loading ? " is-loading" : ""}`} role={loading ? "status" : undefined}>
      <span className={loading ? "loading-indicator" : "empty-state-mark"} aria-hidden="true">{loading ? null : "—"}</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function AppHeader({ deviceId, children }: { deviceId: string; children?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <svg className="brand-mark" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
            <rect x=".5" y=".5" width="29" height="29" rx="8" stroke="currentColor" />
            <path d="M9 20V10h12M9 15h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="m16 21 3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>FreshGuard</span>
          <span className="workspace-label">Cold-chain monitoring</span>
        </div>
        <div className="app-header-context"><span className="device-chip" title={deviceId}>{deviceId}</span>{children}</div>
      </div>
    </header>
  );
}
