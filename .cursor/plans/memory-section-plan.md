# Memory Service Overview — Initial Iteration

## Summary

Add an admin-only **Memory** item immediately below **Comms** in the AgentSync sidebar. The initial page will provide a simple, read-only operational overview of the deployed WAO Mem0 service.

This iteration confirms that the integration is configured and healthy. Browsing, capturing, editing, and deleting memories remain deferred.

## Implementation Changes

- Add `"memory"` to the application view type and place **Memory** below **Comms** with an `MM` icon.
- Show the navigation item only to `platform_admin` users and enforce the same authorization on the server.
- Add `MEMORY_SERVICE_URL` and `MEMORY_SERVICE_API_KEY` to AgentSync’s environment configuration and `.env.example`. Keep the API key entirely server-side.
- Add `GET /api/memory/status`. It will call Mem0’s existing `/healthz` endpoint with a five-second timeout and return a safe, normalized status.
- Treat missing configuration as `unconfigured`, connection failures as `offline`, unhealthy dependencies as `degraded`, and a fully healthy response as `healthy`.
- Build a compact `MemoryView` using existing panels, cards, badges, and responsive styles. Display:
  - Overall service status
  - PostgreSQL availability
  - pgvector availability
  - Service authentication configured or missing
  - Tenant boundary: WAO instance
  - Supported capture modes: Explicit and Automatic
  - Retrieval capability: Semantic Search
  - Last checked timestamp
  - **Refresh Status** action
- Do not modify the Mem0 repository or add an AgentSync database migration.

## Public Interfaces and Types

```ts
type MemoryServiceState =
  | "healthy"
  | "degraded"
  | "offline"
  | "unconfigured";

type MemoryDependencyState =
  | "ok"
  | "unavailable"
  | "unknown";

type MemoryServiceStatus = {
  configured: boolean;
  status: MemoryServiceState;
  database: MemoryDependencyState;
  vectorStore: MemoryDependencyState;
  authenticationConfigured: boolean;
  serviceUrl: string | null;
  checkedAt: string;
};
```

Add `api.memoryStatus()` to the web API client.

The endpoint must never return the service key, authorization headers, upstream response bodies, or internal connection details.

## Test Plan

- Verify Papa and Greg see **Memory** directly below **Comms**.
- Verify regular members do not see it and receive `403` from `/api/memory/status`.
- Verify missing configuration renders **Not Configured** without breaking the page.
- Verify healthy Mem0, PostgreSQL, and pgvector responses render healthy states.
- Verify dependency failure renders **Degraded**.
- Verify timeout, connection failure, and malformed upstream responses render **Offline**.
- Verify manual refresh updates the status and timestamp.
- Verify the service key is absent from API responses, logs, and the production web bundle.
- Run `npm run typecheck`, `npm run build`, and `npm run test:e2e`.
- Perform a live browser pass against the deployed `mem0-wao` Heroku service at desktop and narrow viewport widths.

## Assumptions

- This is an operational overview, not a memory-management interface.
- Memory infrastructure remains visible only to platform administrators until WAO memberships and tenant-scoped permissions exist.
- Memory counts, recent records, semantic-search UI, capture workflows, history, correction, and deletion are deferred.
- The existing Mem0 `/healthz` response is sufficient for this iteration.
- Existing agents, channels, messages, and memories are not assigned to WAO instances by this work.
