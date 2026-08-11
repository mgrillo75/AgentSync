# Phased WAO Multi-Tenant SaaS Implementation

## Summary

Evolve AgentSync into WAO’s tenant-aware connectivity layer, using one shared platform with isolated client `WaoInstance` resources. Target a two-client pilot first; complete security isolation before introducing knowledge, governance, or horizontal scaling.

The existing application remains operational during an additive migration. All current data will be assigned to a bootstrap WAO instance, and PostgreSQL/in-memory store parity will be maintained.

## Recommended Phases

### Phase 0 — Migration and Test Foundation

- Replace the inline database bootstrap schema with ordered, repeatable migrations and migration tracking.
- Add repository-level integration testing for both PostgreSQL and the in-memory store.
- Introduce tenant-context and authorization test helpers before changing production routes.
- Capture baseline relay scenarios: enrollment, connection, human/agent messaging, acknowledgements, offline replay, edits, and loop protection.

Exit gate: migrations can upgrade a copy of the current database without data loss, and existing behavior passes automated regression tests.

### Phase 1 — Establish `WaoInstance` as the Tenant Boundary

- Add `wao_instance_members` with roles `instance_admin`, `operator`, `sme`, and `reviewer`; retain `platform_admin` as a separate platform-wide role.
- Expand instance lifecycle to `provisioning`, `active`, `suspended`, and `archived`.
- Add `wao_instance_id` to tenant-owned tables: agents, LLM agents, provider keys, enrollment tokens, channels, messages, deliveries, and related membership records.
- Create a bootstrap instance and membership set, backfill every existing record into it, validate referential consistency, then make tenant IDs required.
- Add composite constraints so channel members, agents, messages, deliveries, and parent-agent relationships cannot cross instances.
- Introduce tenant-aware store methods rather than unrestricted ID-only lookups.
- Add PostgreSQL row-level security using transaction-scoped tenant context; platform administration uses an explicit privileged path.
- Mirror all tenancy behavior in the in-memory store.

Exit gate: two instances can contain similarly named resources without exposure or cross-tenant relationships, and direct database isolation tests pass.

### Phase 2 — Tenant-Aware Authorization, API, and UI

- Resolve permissions from `User → WaoInstanceMembership → Role`; user ownership remains audit metadata, not the security boundary.
- Scope operational APIs under `/api/wao-instances/:instanceId/...`; never trust a tenant ID from a request without checking membership.
- Restrict instance provisioning and cross-instance inspection to platform administrators.
- Restrict member, credential, policy, and agent management according to instance roles.
- Replace global access-key administration with platform-admin or instance-admin flows.
- Add an active-instance selector and make Dashboard, Agents, Providers, Chat, Relays, and Nexus load only the selected instance.
- Store the selected instance locally as a convenience, but reauthorize it on every session and request.
- Scope browser WebSocket subscriptions to authorized instances and channels.

Exit gate: automated two-client tests prove that REST, browser WebSocket, UI navigation, guessed IDs, and stale sessions cannot expose or mutate another client’s data.

### Phase 3 — Secure AgentSync Connectivity Edge

- Bind enrollment tokens, relay credentials, connected runtimes, rate limits, and loop guards to one WAO instance.
- Require server-side instance and channel membership checks for relay `send`, `edit`, `typing`, `get_chat_info`, acknowledgements, and replay.
- Stop returning a user ID as the relay “tenant”; return the immutable WAO instance ID.
- Introduce a versioned WAO envelope containing instance, message, sender, correlation, causation, schema version, capability, timestamp, and idempotency identifiers.
- Adapt Hermes relay frames into validated WAO envelopes at the edge; keep existing gateway compatibility behind a v1 adapter.
- Add capability grants and reject operations not granted to the connected runtime.
- Preserve durable delivery, acknowledgement reconciliation, reconnect replay, and loop protection.

Exit gate: the two-client pilot can enroll gateways and exchange messages independently, with protocol validation, audit evidence, and no cross-instance relay path.

### Phase 4 — Agent Definition and Release Lifecycle

- Replace the overloaded agent concepts with:
  - `AgentTemplate`: platform-owned reusable starting point.
  - `AgentDefinition`: tenant-owned mutable configuration.
  - `AgentVersion`: immutable released snapshot.
  - `AgentDeployment`: activation of a version in an environment.
  - `AgentRuntime`: connected Hermes gateway or worker.
  - `AgentRun`: one execution with inputs, outputs, status, cost, and trace.
- Migrate current `LlmAgent` records into initial tenant-owned definitions and preserve Hermes `Agent` records as runtimes.
- Add draft, validation, evaluation, approval, release, deployment, rollback, and retirement operations.
- Pin runs and deployments to immutable versions, provider configuration references, tools, permissions, and evaluation results.
- Provide a platform template catalog with explicit copy/version provenance; template upgrades are reviewed migrations, never silent overwrites.

Exit gate: a client can create, evaluate, approve, deploy, run, and roll back an agent without affecting another instance.

### Phase 5 — Client Knowledge and Evaluation Plane

- Add tenant-scoped sources, documents, interviews, claims, ontology terms, chunks, embeddings, provenance, memory, evaluation suites, cases, and results.
- Namespace object storage, vector indexes, Redis keys, secrets, and future search collections by WAO instance.
- Implement the SME workflow: capture → extract → review → approve → retrieve → evaluate.
- Require source provenance for promoted claims and trace retrieved knowledge into agent runs.
- Keep raw client knowledge, prompts, tests, conversations, embeddings, and production artifacts strictly instance-local.
- Introduce configurable retention and deletion policies with auditable processing states.

Exit gate: two clients can ingest overlapping terminology and documents while retrieval and evaluations remain demonstrably isolated.

### Phase 6 — Governed Improvement Loop

- Add tenant constitutions, policies, proposals, approvals, feedback, experiments, release comparisons, reputation events, and audit history.
- Define risk levels and require designated human approval for high-risk deployments or tool capabilities.
- Connect production failures and SME corrections to evaluation cases and candidate agent versions.
- Implement rollback and complete lineage from source material through production run and subsequent version.
- Add an explicit global-promotion workflow: client consent → sanitization/de-identification → human review → generic evaluation → new platform template version.
- Prohibit automatic learning across tenant boundaries.

Exit gate: improvements are reproducible, reversible, attributable, and cannot promote client material globally without recorded consent and review.

### Phase 7 — Horizontal Scale and Enterprise Isolation

- Make API replicas stateless and move WebSocket presence/connection ownership into Redis-backed leases.
- Add pub/sub routing so any API replica can reach the replica holding a destination connection.
- Move deliveries and executions to durable queues with retries, dead-letter handling, idempotency, backpressure, and tenant quotas.
- Add worker pools for ingestion, evaluation, planning, execution, and scheduled governance work.
- Add tenant-aware metrics for latency, queue depth, delivery failures, token/cost budgets, rate limits, and security denials.
- Validate backup/restore by tenant and document incident-response and tenant-offboarding procedures.
- Introduce a deployment abstraction supporting shared infrastructure initially and dedicated database, queue, storage, keys, or data plane for enterprise clients later.

Exit gate: multiple replicas can be added without message loss or duplicate side effects, and one noisy or failing tenant cannot exhaust another tenant’s capacity.

## Public Interfaces and Data Contracts

- Operational REST resources become explicitly instance-scoped: `/api/wao-instances/:instanceId/{members,agents,channels,providers,...}`.
- Relay and browser WebSockets derive an authorized tenant context during connection setup; subsequent frames cannot switch tenants.
- All tenant-owned public types include `waoInstanceId`.
- `WaoInstance.status` expands to the four-state lifecycle.
- Membership responses expose instance role and effective capabilities.
- WAO envelopes and agent versions carry explicit schema versions; consumers reject unsupported versions rather than interpreting them loosely.
- Identifiers remain globally unique, but authorization and storage methods require both tenant and resource identity.
- Errors use `404` where resource existence must not leak across tenants and `403` for known in-tenant permission failures.

## Test Plan

- Migration tests from the current schema, including bootstrap tenant creation, backfill counts, restart idempotency, and rollback/recovery rehearsal.
- Store contract tests run against PostgreSQL and in-memory implementations.
- Tenant-isolation matrices cover every read, write, list, WebSocket, relay, replay, and administrative operation.
- Security tests cover guessed identifiers, forged tenant parameters, cross-tenant parent agents, channel membership, edit/typing operations, revoked membership, suspended instances, and expired credentials.
- Protocol tests cover schema versions, signatures/capabilities, correlation, duplicate delivery, reconnect replay, delayed acknowledgements, and malformed frames.
- Lifecycle tests cover immutable versions, approvals, deployment, rollback, and runs pinned to exact versions.
- Knowledge tests verify storage/vector namespace isolation, provenance, retention, and deletion.
- Load and resilience tests cover multiple replicas, reconnect storms, worker failures, queue retries, tenant quotas, and duplicate-event idempotency.
- Pilot acceptance requires two independent client instances, separate administrators and agents, and a documented attempt to penetrate each isolation boundary.

## Assumptions and Defaults

- The first release target is a two-client pilot, not a full public SaaS launch.
- Existing records move atomically into one bootstrap WAO instance; nothing is discarded.
- PostgreSQL is authoritative in production, while the in-memory store remains supported for local development and tests.
- AgentSync becomes the connectivity and real-time collaboration edge; it does not replace WAO’s canonical Hermes fabric.
- Shared infrastructure with strict logical isolation is the default. Dedicated deployments are deferred until Phase 7.
- Billing, public self-service signup, and automated tenant deletion are outside the pilot unless separately prioritized.
- Each phase is independently deployable and must meet its exit gate before the next phase begins.
