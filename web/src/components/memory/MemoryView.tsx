import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { MemoryDependencyState, MemoryServiceState, MemoryServiceStatus } from "../../types";

const serviceLabels: Record<MemoryServiceState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
  unconfigured: "Not Configured"
};

const dependencyLabels: Record<MemoryDependencyState, string> = {
  ok: "Available",
  unavailable: "Unavailable",
  unknown: "Unknown"
};

function statusClass(state: MemoryServiceState | MemoryDependencyState | "configured" | "missing") {
  if (state === "healthy" || state === "ok" || state === "configured") return "badge success";
  if (state === "degraded" || state === "unavailable" || state === "unconfigured" || state === "missing") return "badge warning";
  if (state === "offline") return "badge danger";
  return "badge";
}

function DetailCard({ label, value, state }: { label: string; value: string; state?: MemoryServiceState | MemoryDependencyState | "configured" | "missing" }) {
  return (
    <article className="memory-detail-card">
      <small>{label}</small>
      {state ? <span className={statusClass(state)}>{value}</span> : <strong>{value}</strong>}
    </article>
  );
}

export function MemoryView() {
  const [status, setStatus] = useState<MemoryServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await api.memoryStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check the memory service.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="view-stack memory-view">
      <section className="panel memory-overview-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Operational overview</p>
            <h2>WAO Memory Service</h2>
          </div>
          <button className="secondary" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Checking..." : "Refresh Status"}
          </button>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {!status && loading ? <p className="muted">Checking service configuration and dependencies...</p> : null}
        {status ? (
          <>
            <div className="memory-status-hero">
              <div>
                <small>Overall service status</small>
                <strong>{serviceLabels[status.status]}</strong>
              </div>
              <span className={statusClass(status.status)}>{serviceLabels[status.status]}</span>
            </div>
            <div className="memory-detail-grid">
              <DetailCard label="PostgreSQL" value={dependencyLabels[status.database]} state={status.database} />
              <DetailCard label="pgvector" value={dependencyLabels[status.vectorStore]} state={status.vectorStore} />
              <DetailCard
                label="Service authentication"
                value={status.authenticationConfigured ? "Configured" : "Missing"}
                state={status.authenticationConfigured ? "configured" : "missing"}
              />
              <DetailCard label="Tenant boundary" value="WAO instance" />
              <DetailCard label="Capture modes" value="Explicit and Automatic" />
              <DetailCard label="Retrieval" value="Semantic Search" />
            </div>
            <p className="memory-checked-at">
              Last checked {new Date(status.checkedAt).toLocaleString()}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}
