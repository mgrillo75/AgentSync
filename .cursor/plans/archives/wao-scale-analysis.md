# Analysis of `wao-scale.md` (GPT-5.6 Phased WAO Multi-Tenant Plan)

**Analyzed against:** the actual AgentSync codebase (~3,400 LOC server, 18 web files), `README.md`, `chat.txt`, and the WAO product context in `../wao/wao-overview.md`.

## Verdict in one paragraph

The plan is **architecturally sound and correctly sequenced** — tenancy before knowledge, isolation before scale, additive migration, exit gates per phase. Its core instincts (derive tenant from membership, never trust request-supplied tenant IDs, immutable versions, no silent cross-tenant learning) are the right ones. Its problem is **scope, not direction**: it packages the entire multi-year WAO vision into one plan while its own stated target is a **two-client pilot**. Roughly half the plan (Phases 4–7) designs subsystems that have no consumers yet, and several choices inside Phases 0–3 are heavier than the current codebase warrants. This report identifies what to simplify, defer, or implement more cheaply.

## Current-state reality check (what the plan is actually starting from)

- **Codebase is small.** 11 server TS files; the largest are `server/db/store.ts` (1,735 lines), `server/routes/api.ts` (782), `server/relay/relayHub.ts` (325). Frontend is a **1,120-line single-file `App.tsx` with no router**.
- **No tests.** No test framework, no test script, no CI. Only `scripts/e2e-relay.mjs`, a live smoke script against a running server.
- **No migrations.** Schema is an inline SQL literal with append-only `alter table ... add column if not exists` (`server/db/store.ts:311-319`). Worse: `resetPasswordAuthSchema` (`store.ts:143-164`) **drops all tables** if a legacy `password_hash` column is found — a live data-loss hazard the plan does not mention.
- **`wao_instances` already exists but is a stub** (`store.ts:174-181`): id/name/status/`created_by` only, referenced by nothing, three platform-admin CRUD routes, and a UI detail view that explicitly says operational modules "will be attached in later iterations."
- **Ownership is per-user, not per-tenant.** `agents`, `llm_agents`, `provider_keys`, `enroll_tokens` hang off `owner_user_id`. The relay enrollment response's `tenant` field is literally the user's ID (`relayHub.ts:128`) — a naming artifact, not tenancy.
- **Single Heroku web dyno, Postgres essential-0.** No Redis, no vector DB, no queues — and none in `package.json`. The README explicitly declares Redis fan-out out of scope.
- **Existing privilege hole:** any authenticated user can create access keys (i.e., mint new users) and list all members (`api.ts:359`). The plan's Phase 1–2 work implicitly fixes this, but never calls it out as motivation.
- **Relay protocol is tiny:** NDJSON frames, ~5 ops (`send`, `edit`, `typing`, `get_chat_info`, acks), `contract_version: 1`, durable delivery + replay + 6-message loop guard already working.

## What the plan gets right (keep these)

- Tenancy before knowledge/governance/scale; security isolation complete before feature planes.
- Additive migration with a bootstrap instance; existing deployment stays live.
- Tenant derived server-side from membership; 404 for cross-tenant existence, 403 for in-tenant permission failures.
- Globally unique IDs with (tenant, resource) authorization — avoids the composite-key-everywhere trap at the API level.
- Relay tenant context fixed at connection setup; frames can't switch tenants.
- Explicit "no automatic learning across tenant boundaries" — matches the founder intent in `chat.txt` (constitution versioned at platform level, inherited per client).
- Per-phase exit gates. Good discipline — but see the serialization note below.

## Simplifications and more efficient implementations

### 1. Split the plan: pilot plan vs. post-pilot vision

The plan's own assumptions say "two-client pilot, not a full public SaaS launch" — yet Phases 4–7 design the agent release lifecycle, a knowledge/evaluation plane with embeddings, a governance loop, and multi-replica horizontal scale. None of that has a consumer in a two-client pilot:

- `LlmAgent` today has **no UI view and no execution engine**. Phase 4's six-entity lifecycle (Template/Definition/Version/Deployment/Runtime/Run) designs the WAO "Build" module before anything runs agents. **Pilot-sized version:** keep `LlmAgent`, add `wao_instance_id`, and snapshot config into an immutable revision row on change. Add Version/Deployment/Run only when a runner exists to consume them.
- Phase 5 assumes **vector indexes, Redis, and object storage that do not exist** and aren't dependencies. "Namespace Redis keys" is Phase 7 speculation leaking into Phase 5. **Defer entirely**; when knowledge work starts, `pgvector` in the existing Postgres avoids new infrastructure.
- Phases 6–7 are vision documents, not pilot work. Move them to a separate `wao-vision.md` so the pilot plan's exit gates stop being gated on speculative design.

**Recommendation:** re-scope this document to Phases 0–3 as "the pilot plan"; park 4–7.

### 2. Drop the in-memory store instead of maintaining parity

Phase 0 mandates contract tests across both stores; Phase 1 mandates mirroring **all** tenancy behavior (including RLS semantics) in the in-memory implementation. That doubles every data-layer change forever — and today parity is only structural (shared `Store` interface via `tsc`), with zero behavioral tests. The memory store exists for local dev convenience, but Postgres is already free (Heroku essential-0, or a 10-line `docker-compose.yml` locally).

**Cheaper path:** delete `MemoryStore`, make Postgres the only store, run tests against a real (throwaway) database. This eliminates an entire class of parity bugs and removes two whole bullets from Phases 0–1. If an in-memory option must stay, restrict it to a stub for unit tests — not a parity implementation.

### 3. RLS is likely over-engineered for the pilot

Row-level security with transaction-scoped tenant context plus an explicit privileged escape path is real complexity in a hand-rolled `pg` data layer (~15 store methods, manual `tx()` helper). With exactly two pilot clients and all access funneled through one small `Store` interface, **tenant-scoped store methods + strong isolation tests** deliver most of the protection at a fraction of the cost. If defense-in-depth is wanted later, apply RLS only to the high-volume/high-value tables (`messages`, `delivery_queue`) as a Phase 1.5 hardening item — not as a pilot gate.

### 4. Composite cross-instance constraints: apply selectively

Composite FKs (`(id, wao_instance_id)` pairs) on every relationship is the textbook approach but churns the entire schema. With globally unique IDs, the realistic cross-tenant write paths are few: `channel_members`, `messages.channel_id`, `delivery_queue`, `llm_agents.parent_id`. **Constrain those four; rely on tenant-scoped queries elsewhere.** Don't gold-plate every FK.

### 5. Phase 0 is right but heavier than necessary — and misses two real hazards

- Migrations: no framework needed. A `migrations/` folder of numbered `.sql` files plus a `schema_migrations` table is ~50 lines (or adopt `node-pg-migrate`, one dependency). 
- The backfill dance ("backfill, validate referential consistency, then make tenant IDs required") can collapse into **one migration**: the production data set is a handful of founder rows. `CREATE bootstrap instance → UPDATE ... SET wao_instance_id → SET NOT NULL` in a single transaction. No phased rollout.
- **Missing from the plan:** (a) the `resetPasswordAuthSchema` drop-all block must be removed *before* any migration system goes live — it will otherwise silently nuke a migrated database that still has a legacy column; (b) **there is no CI** — Phase 0 should add a GitHub Actions workflow running typecheck + the new test suite, or the exit gates have no enforcement mechanism.
- Baseline relay regression tests: **extend `scripts/e2e-relay.mjs`** (it already covers enrollment, acks, browser WS) and add `vitest` for store/route tests. Don't build a bespoke harness.

### 6. Phase 2 understates the frontend cost

Scoping every view behind an instance selector sounds like a bullet point; in reality the frontend is one 1,120-line component with view-switching state and a hand-managed WebSocket. The plan should explicitly include **introducing a router and an instance context**, and splitting `App.tsx` — otherwise Phase 2's UI work lands on a foundation that can't absorb it. This is the single largest unestimated work item in the plan.

### 7. Phase 3: skip the v1 compatibility adapter and the capability system

- The plan keeps "existing gateway compatibility behind a v1 adapter." But the founders control every Hermes gateway in the pilot (enrollment scripts are generated by this very app). **Ship the WAO envelope as protocol v2 and upgrade both gateways** — maintaining an adapter doubles the protocol surface for zero pilot benefit.
- The existing `RelayInboundEvent` already carries `message_id`, `reply_to`, `source.{chat_id,user_id,thread_id}`. The envelope should be an **incremental extension** (add `wao_instance_id`, `schema_version`, idempotency key, correlation/causation) — not a greenfield format with an adaptation layer.
- **Capability grants for ~5 relay ops are over-engineering.** A static per-`agentKind` allowlist covers the pilot; build a grant system when a third op class actually exists.

### 8. Phase 7 contradicts the deployment reality

The app runs as a **single Heroku web dyno**; the README explicitly scopes out Redis fan-out. Redis-backed connection leases, pub/sub routing, durable queues, and worker pools are answers to a load problem a two-client pilot cannot produce. One Fastify process will handle two clients trivially. **Keep only the cheap hygiene:** don't introduce new in-memory connection-ownership assumptions (so replicas remain possible later), and add the tenant-aware metrics. Defer the rest until there's measured load. Tenant quotas matter, but a per-instance counter at the store layer beats a quota subsystem.

### 9. Strict phase serialization is slower than needed

"Each phase must meet its exit gate before the next begins" is good discipline for 0→1→2→3 (they genuinely depend on each other). But 4 (agent lifecycle), 5 (knowledge), and 6 (governance) are **independent tracks**; sequencing them forces a single-file roadmap onto parallelizable work, and client demand should decide which comes first. After the pilot, reorder by pull, not by plan.

### 10. Smaller gaps the plan should acknowledge

- **Rate limiting:** Phase 3 says "bind rate limits to one WAO instance" — but **no rate limiting exists today** to bind. Add basic per-IP/per-session limiting to Phase 2 (it's a pilot security hole independent of tenancy).
- **The access-key privilege hole** (`api.ts:359`): any user can mint users. Worth calling out in Phase 1 as an explicit fix, since it currently undermines every other isolation guarantee.
- **No cost or effort estimates anywhere.** Even t-shirt sizes per phase would make the "independently deployable" claim testable.
- **Hermes fabric assumption:** the plan says AgentSync "does not replace WAO's canonical Hermes fabric," but per `wao-overview.md` the wao-platform repo's Hermes is prototype-stage. The plan should state what "canonical Hermes fabric" concretely refers to, or Phase 3's adapter boundary is undefined.

## Suggested re-shaped roadmap

| Phase | Content | Change from original |
|---|---|---|
| 0 | Remove drop-all hazard; numbered SQL migrations; `vitest` + extended `e2e-relay.mjs`; GitHub Actions CI | Lighter; adds CI and hazard removal |
| 1 | `wao_instance_id` + memberships + bootstrap backfill as **one migration**; tenant-scoped store methods; composite FKs on the 4 risky relations only; **delete MemoryStore**; fix access-key hole | Drops RLS and memory-parity mirroring |
| 2 | Instance-scoped routes + authorization; **frontend router + instance context + App.tsx split**; instance selector; basic rate limiting | Adds frontend refactor and rate limiting |
| 3 | Extend existing envelope in place (instance ID, schema version, idempotency); per-`agentKind` op allowlist; relay membership checks | Drops v1 adapter and capability-grant system |
| — | Vision doc: agent lifecycle, knowledge plane, governance, scale | Reordered by client pull after pilot |

**Bottom line:** keep the plan's sequencing instincts, isolation model, and exit-gate discipline — Phases 0–3 are the right plan. Cut RLS, in-memory parity, the compat adapter, and capability grants from the pilot; delete or defer everything past Phase 3; and add the three things it forgot (CI, the drop-all hazard, the frontend refactor). The result is a pilot that ships in a fraction of the time with the same isolation guarantees that actually matter for two clients.
