# WAO Multi-Tenant Pilot Implementation (Revised)

## Summary

Evolve AgentSync into WAO's tenant-aware connectivity layer for a **two-client pilot**, using one shared platform with isolated client `WaoInstance` resources. This revision scopes the work to what the pilot actually needs: migrations and a test foundation, tenant isolation, tenant-aware authorization/API/UI, and a secure relay edge. The original plan's Phases 4–7 (agent release lifecycle, knowledge plane, governance loop, horizontal scale) are **deferred to a separate post-pilot vision track** and reordered by client pull — none of them have consumers in a two-client pilot.

Key simplifications versus the original plan:

- **PostgreSQL is the only store.** The in-memory store is deleted in Phase 1 rather than kept in parity; maintaining a second implementation of the tenancy model would double every data-layer change for a dev-only convenience.
- **No row-level security in the pilot.** Tenant-scoped store methods plus strong isolation tests over a small, single `Store` interface provide the isolation that matters for two clients. RLS on `messages`/`delivery_queue` is an optional post-pilot hardening item.
- **No v1 relay compatibility adapter and no capability-grant system.** The founders control every pilot gateway, so the envelope is extended in place and gateways are upgraded; ~5 relay ops need a static allowlist, not a grants subsystem.
- **One backfill migration**, not a phased validate-then-constrain rollout — the existing data set is a handful of founder rows.

The existing application remains operational during an additive migration. All current data is assigned to a bootstrap WAO instance.

## Phase 0 — Migration and Test Foundation

- **Remove the `resetPasswordAuthSchema` drop-all block** (`server/db/store.ts:143-164`) *before* any migration work. It drops every table when a legacy `password_hash` column is detected and would silently destroy a migrated database.
- Replace the inline bootstrap schema with numbered SQL files in a `migrations/` directory plus a `schema_migrations` tracking table (hand-rolled, ~50 lines, or `node-pg-migrate` — no heavier framework).
- Add `vitest` and write repository-level integration tests against a real (throwaway) PostgreSQL database.
- Extend the existing `scripts/e2e-relay.mjs` to cover the current baseline relay scenarios: enrollment, connection, human/agent messaging, acknowledgements, offline replay, edits, and loop protection. Do not build a bespoke harness.
- **Add CI (GitHub Actions)** running `typecheck`, the vitest suite, and the e2e relay script. Without CI the exit gates below have no enforcement mechanism.
- Introduce tenant-context and authorization test helpers before changing production routes.

Exit gate: migrations upgrade a copy of the current database without data loss, existing behavior passes automated regression tests, and CI is green on every push.

## Phase 1 — Establish `WaoInstance` as the Tenant Boundary

- Add `wao_instance_members` with roles `instance_admin`, `operator`, `sme`, and `reviewer`; retain `platform_admin` as a separate platform-wide role.
- Expand instance lifecycle to `provisioning`, `active`, `suspended`, and `archived`.
- Add `wao_instance_id` to tenant-owned tables: agents, LLM agents, provider keys, enrollment tokens, channels, channel members, messages, and deliveries.
- Perform the bootstrap **as a single migration**: create the bootstrap instance and founder memberships, `UPDATE` every existing record into it, then `SET NOT NULL` — all in one transaction. The data volume makes a staged backfill unnecessary.
- Add composite constraints **only on the four realistic cross-tenant write paths**: `channel_members`, `messages.channel_id`, `delivery_queue`, and `llm_agents.parent_id`. Rely on tenant-scoped queries elsewhere; do not gold-plate every foreign key.
- Introduce tenant-aware store methods requiring both tenant and resource identity, replacing unrestricted ID-only lookups.
- **Delete `MemoryStore`** and make PostgreSQL the sole store (local dev uses Docker or a throwaway Heroku Postgres). This eliminates the parity-maintenance tax instead of institutionalizing it.
- **Fix the access-key privilege hole** (`api.ts:359`): today any authenticated user can mint access keys (i.e., create users). Restrict key creation to `platform_admin` / `instance_admin` as part of the membership model — this hole currently undermines every other isolation guarantee.

Exit gate: two instances can contain similarly named resources without exposure or cross-tenant relationships, and direct store-level isolation tests pass in CI.

## Phase 2 — Tenant-Aware Authorization, API, and UI

- Resolve permissions from `User → WaoInstanceMembership → Role`; user ownership remains audit metadata, not the security boundary.
- Scope operational APIs under `/api/wao-instances/:instanceId/...`; never trust a tenant ID from a request without checking membership.
- Restrict instance provisioning and cross-instance inspection to platform administrators.
- Restrict member, credential, policy, and agent management according to instance roles.
- Replace global access-key administration with platform-admin or instance-admin flows.
- **Frontend foundation first:** `App.tsx` is a single ~1,120-line component with view-switching state. Introduce a router, split the views into route components, and add an instance context *before* scoping the UI — this is the largest work item in the phase and must not be absorbed ad hoc.
- Add an active-instance selector and make Dashboard, Agents, Providers, Comms, and Relays load only the selected instance.
- Store the selected instance locally as a convenience, but reauthorize it on every session and request.
- Scope browser WebSocket delivery to authorized instances and channels.
- **Add basic rate limiting** (per-IP on auth endpoints, per-session on API mutations). None exists today, so Phase 3's per-instance limits need this foundation regardless.

Exit gate: automated two-client tests prove that REST, browser WebSocket, UI navigation, guessed IDs, and stale sessions cannot expose or mutate another client's data.

## Phase 3 — Secure AgentSync Connectivity Edge

- Bind enrollment tokens, relay credentials, connected runtimes, and the loop guard to one WAO instance.
- Require server-side instance and channel membership checks for relay `send`, `edit`, `typing`, `get_chat_info`, acknowledgements, and replay.
- Stop returning a user ID as the relay "tenant" (`relayHub.ts:128`); return the immutable WAO instance ID.
- **Extend the existing relay envelope in place** — add `wao_instance_id`, `schema_version`, idempotency key, and correlation/causation identifiers to the current `RelayInboundEvent`/frame format. No greenfield envelope and **no v1 compatibility adapter**: the founders control every pilot gateway, so all gateways are upgraded to the new schema version directly.
- Enforce a **static per-`agentKind` operation allowlist** at the edge instead of a capability-grant subsystem; five relay ops do not justify a grants model.
- Preserve durable delivery, acknowledgement reconciliation, reconnect replay, and loop protection.

Exit gate: the two-client pilot can enroll gateways and exchange messages independently, with protocol validation, audit evidence, and no cross-instance relay path.

## Post-Pilot Vision (deferred — reorder by client pull, not by plan)

The following tracks from the original plan are intentionally **not** part of the pilot. They are independent of each other and should be scheduled by client demand after the pilot exit gates are met. Each requires a dedicated design pass at that time.

- **Agent definition and release lifecycle** (templates, immutable versions, deployments, runs). Start only when an execution engine exists to consume versions; until then, `LlmAgent` plus an immutable config-snapshot revision on change is sufficient. Today `LlmAgent` has no UI and no runner.
- **Client knowledge and evaluation plane.** Requires vector storage, object storage, and ingestion workers that do not exist yet; when started, prefer `pgvector` in the existing Postgres over new infrastructure.
- **Governed improvement loop** (constitutions, proposals, experiments, global promotion with consent). Note the founder intent from discovery: constitution is versioned at platform level and inherited/extended per client.
- **Horizontal scale** (Redis connection leases, pub/sub routing, durable queues, worker pools). The deployment is a single Heroku web dyno and the README scopes Redis fan-out out; one process handles two clients trivially. Preserve only the cheap hygiene now: no new in-memory connection-ownership assumptions, plus tenant-aware metrics (latency, delivery failures, rate-limit and security denials). Optional hardening in this track: RLS on `messages`/`delivery_queue`.

## Public Interfaces and Data Contracts

- Operational REST resources become explicitly instance-scoped: `/api/wao-instances/:instanceId/{members,agents,channels,providers,...}`.
- Relay and browser WebSockets derive an authorized tenant context during connection setup; subsequent frames cannot switch tenants.
- All tenant-owned public types include `waoInstanceId`.
- `WaoInstance.status` expands to the four-state lifecycle.
- Membership responses expose instance role and effective capabilities.
- Relay frames carry an explicit `schema_version`; consumers reject unsupported versions rather than interpreting them loosely.
- Identifiers remain globally unique, but authorization and storage methods require both tenant and resource identity.
- Errors use `404` where resource existence must not leak across tenants and `403` for known in-tenant permission failures.

## Test Plan

- Migration tests from the current schema: bootstrap tenant creation, backfill counts, restart idempotency, and rollback/recovery rehearsal — all runnable in CI against throwaway Postgres.
- Store tests run against the single PostgreSQL implementation (no parity matrix to maintain).
- Tenant-isolation coverage for every read, write, list, WebSocket, relay, replay, and administrative operation, prioritized by realistic attack paths rather than a mechanical full matrix.
- Security tests: guessed identifiers, forged tenant parameters, cross-tenant parent agents, channel membership, edit/typing operations, revoked membership, suspended instances, expired credentials, and the fixed access-key privilege hole.
- Protocol tests: schema versions, correlation, duplicate delivery, reconnect replay, delayed acknowledgements, and malformed frames.
- Load/resilience testing is limited to what the pilot can exhibit: reconnect storms and duplicate-event idempotency on a single replica.
- Pilot acceptance requires two independent client instances, separate administrators and agents, and a documented attempt to penetrate each isolation boundary.

## Assumptions and Defaults

- The release target is a two-client pilot, not a full public SaaS launch.
- Existing records move atomically into one bootstrap WAO instance in a single migration; nothing is discarded.
- PostgreSQL is the only store, in production, local development, and tests.
- The founders control all pilot gateways, so relay protocol upgrades ship without a compatibility adapter.
- AgentSync becomes the connectivity and real-time collaboration edge; what "WAO's canonical Hermes fabric" concretely refers to must be pinned down before Phase 3 (the referenced wao-platform Hermes is prototype-stage), or the protocol boundary is undefined.
- Shared infrastructure with strict logical isolation is the default; dedicated deployments and horizontal scale are post-pilot concerns.
- Billing, public self-service signup, and automated tenant deletion are outside the pilot.
- Each phase is independently deployable and must meet its exit gate before the next phase begins; post-pilot tracks are reordered by client pull.
