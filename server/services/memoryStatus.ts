export type MemoryServiceState = "healthy" | "degraded" | "offline" | "unconfigured";

export type MemoryDependencyState = "ok" | "unavailable" | "unknown";

export type MemoryServiceStatus = {
  configured: boolean;
  status: MemoryServiceState;
  database: MemoryDependencyState;
  vectorStore: MemoryDependencyState;
  authenticationConfigured: boolean;
  serviceUrl: string | null;
  checkedAt: string;
};

type HealthPayload = {
  status: "ok" | "unhealthy";
  database: "ok" | "unavailable";
  pgvector: "ok" | "unavailable";
};

function safeServiceUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function healthUrl(serviceUrl: string): string {
  return `${serviceUrl}/healthz`;
}

function isHealthPayload(value: unknown): value is HealthPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    (payload.status === "ok" || payload.status === "unhealthy") &&
    (payload.database === "ok" || payload.database === "unavailable") &&
    (payload.pgvector === "ok" || payload.pgvector === "unavailable")
  );
}

export async function getMemoryServiceStatus(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch
): Promise<MemoryServiceStatus> {
  const rawServiceUrl = env.MEMORY_SERVICE_URL?.trim() || null;
  const serviceUrl = rawServiceUrl ? safeServiceUrl(rawServiceUrl) : null;
  const serviceKey = env.MEMORY_SERVICE_API_KEY?.trim() || null;
  const checkedAt = new Date().toISOString();
  const authenticationConfigured = Boolean(serviceKey);

  if (!rawServiceUrl || !serviceKey) {
    return {
      configured: false,
      status: "unconfigured",
      database: "unknown",
      vectorStore: "unknown",
      authenticationConfigured,
      serviceUrl,
      checkedAt
    };
  }

  const offline = (): MemoryServiceStatus => ({
    configured: true,
    status: "offline",
    database: "unknown",
    vectorStore: "unknown",
    authenticationConfigured: true,
    serviceUrl,
    checkedAt
  });

  if (!serviceUrl) return offline();

  try {
    const response = await fetcher(healthUrl(serviceUrl), {
      headers: { Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(5_000)
    });
    const payload: unknown = await response.json();
    if (!isHealthPayload(payload)) return offline();

    const database: MemoryDependencyState = payload.database;
    const vectorStore: MemoryDependencyState = payload.pgvector;
    const fullyHealthy = response.ok && payload.status === "ok" && database === "ok" && vectorStore === "ok";
    const degraded = payload.status === "unhealthy" || database === "unavailable" || vectorStore === "unavailable";

    if (!fullyHealthy && !degraded) return offline();
    return {
      configured: true,
      status: fullyHealthy ? "healthy" : "degraded",
      database,
      vectorStore,
      authenticationConfigured: true,
      serviceUrl,
      checkedAt
    };
  } catch {
    return offline();
  }
}
