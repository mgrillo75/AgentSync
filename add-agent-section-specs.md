# AgentSync — Provider API Keys + LLM Agent Builder with Swarm Graph

## Context

AgentSync today only "pairs" external Hermes gateway agents over the relay — there is no way to create an LLM agent inside the app, and no concept of provider API keys. This phase adds two new sidebar sections (below **Chat**, where the user marked the red box):

1. **Providers** — the user stores an API key per LLM provider (OpenAI, Anthropic, Google, xAI).
2. **Swarm** — the user creates LLM agents (name, provider, model, role, tools) and sees them visualized as a node graph styled like SwarmClaw's Org Chart: dark dot-grid canvas, 200px node cards (avatar, name, model subtitle, description, COORDINATOR/WORKER badge, tool chips, status dot), curved bezier edges from coordinators to workers, pan/zoom, drag-to-position.

**Scope guard (this phase only):** agents are created and visualized — they do NOT call LLMs yet. Keys are stored encrypted so a later phase can use them. Creating an agent requires a stored key for its provider. The existing "Agents" (Hermes pairing) section is untouched.

SwarmClaw's org chart (`C:\Users\Papa\Documents\git-repos\swarmclaw-2\src\components\org-chart\`) is a **custom implementation — no graph library needed** (SVG bezier edges + absolutely positioned divs + CSS-transform pan/zoom). We port it and translate its Tailwind styles to AgentSync's plain-CSS tokens, using `--purple: #a78bfa` as the swarm accent (closest to SwarmClaw's indigo, keeps teal as the app primary).

---

## Part A — Server

### A1. AES-GCM encryption — `server/crypto.ts`
Add `encryptSecret(plaintext)` / `decryptSecret(payload)` using AES-256-GCM (`node:crypto`, no new deps). Format: `v1:<iv>:<tag>:<cipher>` base64url. Key = sha256 digest (Buffer) of `KEY_ENCRYPTION_SECRET || APP_SECRET || COOKIE_SECRET || "dev-cookie-secret-change-me"` — same fallback chain as the cookie secret in `server/index.ts:85`. Warn at startup (near the memory-store warning ~`index.ts:80`) if no env secret is set.

### A2. Types — `server/types.ts`
```ts
type LlmAgentRole = "coordinator" | "worker";
type LlmAgent = { id, ownerUserId, name, description: string|null, provider, model,
  role: LlmAgentRole, tools: string[], avatarSeed, parentId: string|null,
  x: number|null, y: number|null, createdAt, updatedAt };
type ProviderKey = { id, ownerUserId, provider, label, encryptedKey, keyPreview, createdAt };
```
`encryptedKey` is always stripped before responses (same pattern as agent `secret`/`deliveryKey` stripping in `api.ts:203`).

### A3. Store — `server/db/store.ts` (interface + **both** PgStore and MemoryStore)
Append to the `schema` SQL string (after ~line 203):
```sql
create table if not exists provider_keys (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  provider text not null, label text not null,
  encrypted_key text not null, key_preview text not null,
  created_at timestamptz not null default now(),
  unique (owner_user_id, provider)
);
create table if not exists llm_agents (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  name text not null, description text,
  provider text not null, model text not null,
  role text not null check (role in ('coordinator','worker')),
  tools jsonb not null default '[]'::jsonb,
  avatar_seed text not null,
  parent_id text references llm_agents(id) on delete set null,
  x double precision, y double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_provider_keys_owner on provider_keys(owner_user_id);
create index if not exists idx_llm_agents_owner on llm_agents(owner_user_id);
create index if not exists idx_llm_agents_parent on llm_agents(parent_id);
```
One key per provider per owner → `POST` is an upsert (rotate = resubmit).

New `Store` methods (implement in PgStore + MemoryStore, follow `mapAgent`/`toIso` mapper style, ids `randomId("pk")` / `randomId("lag")`):
```ts
upsertProviderKey({ownerUserId, provider, label, encryptedKey, keyPreview}): Promise<ProviderKey>
listProviderKeys(ownerUserId): Promise<ProviderKey[]>
deleteProviderKey(ownerUserId, providerKeyId): Promise<boolean>
createLlmAgent({ownerUserId, name, description, provider, model, role, tools, avatarSeed, parentId}): Promise<LlmAgent>
listLlmAgents(ownerUserId): Promise<LlmAgent[]>
getLlmAgentById(id): Promise<LlmAgent | null>
updateLlmAgent(id, patch: Partial<name|description|model|role|tools|parentId|x|y>): Promise<LlmAgent | null>
deleteLlmAgent(id): Promise<boolean>
```
MemoryStore: two new Maps; on `deleteLlmAgent` manually null out children's `parentId` (no FK).

### A4. REST routes — `server/routes/api.ts`
All `requireUser`-guarded + zod-validated (follow `POST /api/access-keys` at `api.ts:234`). Reuse `accessKeyPreview` (`api.ts:21`) for previews. Server imports use `.js` extensions (NodeNext ESM).

| Endpoint | Body | Response |
|---|---|---|
| `GET /api/provider-keys` | — | `{ providerKeys: ProviderKeyView[] }` |
| `POST /api/provider-keys` | `{ provider, label?, key }` | `{ providerKey }` (key encrypted, never echoed) |
| `DELETE /api/provider-keys/:id` | — | `{ ok: true }` / 404 |
| `GET /api/llm-agents` | — | `{ llmAgents: LlmAgent[] }` |
| `POST /api/llm-agents` | `{ name, description?, provider, model, role, tools?, avatarSeed?, parentId? }` | `{ llmAgent }` |
| `PATCH /api/llm-agents/:id` | subset incl. `x`/`y` | `{ llmAgent }` / 404 |
| `DELETE /api/llm-agents/:id` | — | `{ ok: true }` / 404 |

Rules on create: 400 if no stored key for `provider` ("Add a <provider> API key in Providers first."); `parentId` must exist, be owned by user, and have `role === "coordinator"`; default `avatarSeed = randomSecret(8)`. PATCH/DELETE: 404 when missing or not owned (pattern at `api.ts:316-320`); reject `parentId === id`. Deleting a provider key does NOT delete agents (provider is a plain string; create form just stops offering it). Provider enum: `z.enum(["openai","anthropic","google","xai"])`.

---

## Part B — Web

### B1. Types + provider catalog
- `web/src/types.ts`: add `LlmAgent`, `LlmAgentRole`, `ProviderKey` (view shape, no encryptedKey).
- New `web/src/lib/providers.ts`: `PROVIDERS` array — id/label/defaultModel/model suggestions for openai, anthropic, google, xai. Model field in the form is free text + `<datalist>` (no LLM calls yet, so exact ids are low-stakes).

### B2. API client — `web/src/lib/api.ts`
Add 7 methods wrapping the endpoints above via the existing `request<T>` helper (`api.ts:3`).

### B3. Layout helper — new `web/src/lib/swarmLayout.ts`
Port from `swarmclaw-2/src/lib/org-chart.ts`: `buildOrgTree` (adapt to flat `LlmAgent[]` + `parentId`; keep the cycle guard; **all parentless agents are roots** — drop the "unattached" bucket) and `layoutTree` near-verbatim (tidy tree; `NODE_W=200, NODE_H=110, levelGap=120, siblingGap=40`). Drop `computeOrgChartMove`, `deriveTeams`, `getDescendantIds`.

### B4. Swarm components — new `web/src/components/swarm/`
| Port from (swarmclaw-2) | New file | Notes |
|---|---|---|
| `use-org-chart-pan-zoom.ts` | `useSwarmPanZoom.ts` | keep all: wheel-zoom toward cursor (clamp 0.15–3), pointer pan, zoomIn/Out, fitToScreen |
| `use-org-chart-drag.ts` | `useSwarmDrag.ts` | keep screenToCanvas + pointer-capture drag + 20px grid snap; drop drop-to-reparent |
| `org-chart-edge.tsx` | `SwarmEdge.tsx` | bezier `M x1 y1 C x1 midY, x2 midY, x2 y2` (parent bottom-center → child top-center) + 20px invisible hit path; drop animations |
| `org-chart-node.tsx` | `SwarmNode.tsx` | drag handle (6-dot svg, `stopPropagation`), avatar, name, truncated model subtitle, 2-line description, role badge, tool chips + "+N" overflow (4 shown), status dot; drop ports/glow/team badges/shimmer |
| `org-chart-view.tsx` | `SwarmView.tsx` | dot-grid SVG pattern offset by transform, transform layer div, edges SVG, positioned nodes, auto-fit on load, saved-positions-else-autolayout merge, empty state; drop teams/context menu/detail panel/delegation |
| `agents/agent-avatar.tsx` | `AgentAvatar.tsx` | `multiavatar(seed)` → DOMPurify sanitize → `dangerouslySetInnerHTML`; initials fallback (reuse `initials()` logic, App.tsx:366) |
| — new | `CreateAgentPanel.tsx` | overlay card + scrim (no modal infra exists) |

**SwarmView:** fetches `listLlmAgents` + `listProviderKeys` on mount; toolbar strip (Create Agent, zoom in/out/fit, count); drag end → optimistic x/y + `PATCH`; node select (purple ring) + Delete affordance; combined pan/drag pointer handlers.

**CreateAgentPanel:** name (required), description, provider select **filtered to providers with stored keys**, model input + datalist (prefill defaultModel), role select (worker default), "Reports to" select of existing coordinators (hidden if none), tools comma-separated input, avatar preview + Randomize seed button. If zero keys: form disabled with hint + "Go to Providers" button (`onGoToProviders` prop → `setActiveView("providers")`).

### B5. ProvidersPanel — in `web/src/App.tsx`
Model directly on `AccessPanel` (App.tsx:166-245): provider select + optional label + password-type key input → `createProviderKey` → refetch; list rows with provider, `keyPreview`, date, Delete button. Note text: "Keys are encrypted at rest and never shown again. Resubmitting a provider replaces its key."

### B6. Styles — append `/* Swarm graph */` section to `web/src/styles.css`
Translate the Tailwind card styles to plain CSS using existing tokens: `.swarm-shell`, `.swarm-toolbar`, `.swarm-canvas` (`background:#0a0e17`, rounded 16px, `touch-action:none`), `.swarm-grid`, `.swarm-layer` (`transform-origin:0 0`), `.swarm-node` (200px, radius 14px, `var(--card-soft)` bg) + `.coordinator` / `.selected` / `.dragging` variants (purple rgba ring/border), `.swarm-node-handle`, `.swarm-node-name/-model/-desc` (2-line clamp), `.swarm-role-badge` (9px uppercase; purple coordinator / muted worker), `.swarm-tool-chip` (8px), `.swarm-node-status`, `.swarm-avatar` (28px), `.swarm-empty`, `.swarm-modal-scrim` + `.swarm-modal`.

### B7. App.tsx wiring
1. `type AppView = "dashboard" | "agents" | "swarm" | "providers" | "access" | "chat"` (line 9).
2. `navItems`: append `{ id: "swarm", label: "Swarm", icon: "SW" }` and `{ id: "providers", label: "Providers", icon: "PR" }` after chat (matches the red-box placement).
3. Two new conditional render blocks (after chat, ~line 690): `PageHeader` + `<SwarmView onGoToProviders={...} />`; `PageHeader` + `<ProvidersPanel />`. Both views own their data — no changes to existing refresh logic.

---

## Part C — Dependencies & env
- npm (devDependencies, alongside react/vite): `@multiavatar/multiavatar@^1.0.7`, `dompurify@^3.4.1` (ships own types). Browser-only — never import into server code.
- `.env.example` + README: `KEY_ENCRYPTION_SECRET=` (falls back to APP_SECRET → COOKIE_SECRET; changing it after keys are stored makes them undecryptable later).

## Part D — Verification
1. `npm install && npm run typecheck && npm run dev` (vite :5173 proxying to :3000). Log in with a founder key.
2. **Providers:** add an Anthropic key → row with preview; resubmit same provider → replaces (one row); delete → gone.
3. **Swarm:** with zero keys, create form disabled with hint; "Go to Providers" jumps. Add a key → create a coordinator + two workers reporting to it → auto-layout, curved edges coordinator-bottom → worker-top, avatars/badges/chips render like SwarmClaw.
4. Drag node by handle (20px snap), wheel-zoom toward cursor, pan on empty canvas. **Hard refresh → positions persist.**
5. Delete coordinator → workers become roots (`on delete set null` + MemoryStore equivalent). Delete provider key → graph unchanged, provider disappears from create form.
6. Both stores: MemoryStore (no DATABASE_URL, in-session only) and Postgres (survives restart; `tools` is valid jsonb).
7. API guards: create with keyless provider → 400 with hint; worker as `parentId` → 400; another user's agent id → 404.

## Part E — Gotchas
1. **NodeNext ESM:** all new server imports need `.js` extensions (`"../crypto.js"`).
2. **jsonb via pg:** `JSON.stringify(tools)` for insert/update params (JS array serializes as a PG array literal and fails — see `createDelivery`, store.ts:719).
3. **`create table if not exists` won't alter shape** — if iterating on columns against a persistent dev DB, drop the two new tables manually. Also the legacy `resetPasswordAuthSchema` drop-cascade (store.ts:94-115) would take new tables with it (fine for current DBs).
4. **Wheel zoom:** if page scroll bleeds through, attach a native `wheel` listener with `{ passive: false }` in a `useEffect` instead of React's `onWheel`.
5. **SPA fallback swallows `/api` typos** (returns index.html) — double-check client paths against routes.
6. **Drag stale closures:** keep SwarmClaw's ref-mirroring pattern (`dragRef` alongside state) and the `stopPropagation` on the drag handle so pan and drag stay mutually exclusive.

## Critical files
- `server/crypto.ts`, `server/types.ts`, `server/db/store.ts`, `server/routes/api.ts`, `server/index.ts` (startup warning), `.env.example`
- `web/src/App.tsx`, `web/src/types.ts`, `web/src/lib/api.ts`, `web/src/styles.css`
- New: `web/src/lib/providers.ts`, `web/src/lib/swarmLayout.ts`, `web/src/components/swarm/{SwarmView,SwarmNode,SwarmEdge,AgentAvatar,CreateAgentPanel}.tsx`, `web/src/components/swarm/{useSwarmPanZoom,useSwarmDrag}.ts`
- Port sources: `swarmclaw-2/src/components/org-chart/*` + `swarmclaw-2/src/lib/org-chart.ts`