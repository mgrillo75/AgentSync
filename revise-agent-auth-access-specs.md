# AgentSync — DAC Agent Authorization (authorize once / reconnect forever / revoke anytime)

## Context

AgentSync agents currently "pair" via a utility flow (`POST /api/agents/pair`) that mints a permanent secret. This revision reframes connection as an explicit **discretionary access control** model, per the owner's three requirements:

1. A logged-in member **authorizes** an LLM agent to connect (member-initiated grant — confirmed choice).
2. Authorization happens **once**; the agent reconnects indefinitely, member online or not.
3. A member can authorize **many agents across many systems** (laptop, desktop, server).

**Verified current state:** requirements 2 & 3 already work mechanically — the agent's authority is a non-expiring `secret` (agents table), fully decoupled from member sessions; agents mint short-lived HMAC upgrade tokens client-side and reconnect forever; one member can have unlimited agents; offline agents drain queued deliveries on reconnect. **What's missing** is the DAC framing: device/system identity on authorizations, a management UI, and — critically — **revocation, which does not exist at any layer** (no API, no store method, no `revoked_at` column, no UI, and deleting a row wouldn't kick a live socket since connections live in the in-memory `RelayHub.connections` map).

**Scope:** authorization metadata + revocation end-to-end + Authorizations manager UI + two contained security hardenings (remove the `exp === 0` never-expires token branch; encrypt agent secrets at rest using the existing `encryptSecret`/`decryptSecret` AES-GCM helpers).

**Decisions made:**
- **Revoke = tombstone, not hard delete.** Mirrors the existing `access_keys.revoked_at` pattern (schema store.ts:161; AccessPanel "Revoked" badge App.tsx:237-243); hard delete would cascade `delivery_queue` and orphan message history; members should see what *was* authorized. Re-authorization = new authorize (new gatewayId + secret); no un-revoke.
- **Secret encryption at rest: include.** Encrypt-on-write only + a `getAgentSecret()` helper with plaintext fallback for legacy rows — no bulk migration. Only 2 read sites (relay upgrade verification, setup-script route).
- **Rename route to `POST /api/agents/authorize`** (callers are only `web/src/lib/api.ts:65` and `scripts/e2e-relay.mjs:76`, both updated here; response shape unchanged + new fields).
- **`exp === 0` removal verified safe:** Hermes gateway source (`git-repos/hermes-agent/gateway/relay/auth.py`) *can* mint exp=0 but both real call sites use the default 300s TTL with no override path. Verify-side-only deviation; note in commit message.

---

## Step 1 — Types

**`server/types.ts`** — extend `Agent` (lines 18-28):
```ts
systemLabel: string | null;
systemType: "laptop" | "desktop" | "server" | "other" | null;
agentKind: string | null;   // e.g. "hermes", "claude-code", "openclaw"
revokedAt: string | null;
```
Export `AgentSystemType`. **`web/src/types.ts`** — same four fields on client `Agent` (lines 18-26).

## Step 2 — Schema + Store (`server/db/store.ts`, BOTH PgStore and MemoryStore)

**2a.** Add the four columns to the `agents` create-table block (lines 183-193) for fresh installs, AND append additive migrations at the end of the same `schema` template string (it runs as one `pool.query`; `create table if not exists` won't alter existing tables):
```sql
alter table agents add column if not exists system_label text;
alter table agents add column if not exists system_type text;
alter table agents add column if not exists agent_kind text;
alter table agents add column if not exists revoked_at timestamptz;
```
**2b.** `mapAgent` (store.ts:302-314): map the four new fields (`toIso(row.revoked_at)`).

**2c.** `Store` interface (store.ts:52-62): extend `createAgent` input with the three metadata fields; add `revokeAgent(ownerUserId: string, agentId: string): Promise<Agent | null>`.

**2d. PgStore:**
- `createAgent` (store.ts:652-672): insert new columns; **guard resurrection** — `on conflict (gateway_id) do update set ... where agents.revoked_at is null returning *`; if no row returned (revoked), `throw new Error("gateway id belongs to a revoked agent")`.
- `revokeAgent`: `update agents set revoked_at = now(), connected_at = null where id=$1 and owner_user_id=$2 and revoked_at is null returning *` → `mapAgent` or null.
- `listAgentsForChannel` (store.ts:857-866): add `and a.revoked_at is null` (stops routing + delivery-queue growth for revoked agents).

**2e. MemoryStore parity:** `createAgent` throws on existing revoked gatewayId; `revokeAgent` sets `revokedAt`/nulls `connectedAt` with owner check; `listAgentsForChannel` (store.ts:1315-1320) filters `!agent.revokedAt`.

## Step 3 — Crypto (`server/crypto.ts`)

Line 85: change `if (exp !== 0 && Math.floor(Date.now()/1000) > exp)` → `if (Math.floor(Date.now()/1000) > exp)`. (Closes the never-expiring-token escape hatch; compatibility verified above.)

## Step 4 — Provisioning (`server/services/agentProvisioning.ts`)

- Extend input with `systemLabel`/`systemType`/`agentKind` (nullable) and pass through to `createAgent`.
- Encrypt at rest: keep plaintext locals for the return value; store `encryptSecret(secret)` / `encryptSecret(deliveryKey)`.
- Add and export:
```ts
export function getAgentSecret(agent: Agent): string {
  return agent.secret.startsWith("v1:") ? decryptSecret(agent.secret) : agent.secret;
}
```
- `RelayHub.enroll` (relayHub.ts:104-126) calls provisioning without metadata — fine (nullable), but wrap in try/catch so the revoked-gatewayId throw becomes `return null` → 403 at `/relay/enroll`.

## Step 5 — RelayHub (`server/relay/relayHub.ts`)

**5a.** `handleUpgrade` (lines 83-102): after `getAgentByGatewayId` — `if (!agent || agent.revokedAt) return rejectUpgrade(socket);` and verify with `getAgentSecret(agent)` (import from `../services/agentProvisioning.js`).

**5b.** New public method:
```ts
disconnectAgent(agentId: string, code = 4403, reason = "revoked"): boolean {
  const connection = this.connections.get(agentId);
  if (!connection || connection.ws.readyState !== WebSocket.OPEN) return false;
  connection.ws.close(code, reason);
  return true;
}
```
Do NOT duplicate cleanup — the existing `onSocketClose` (lines 167-178) already removes the map entry, calls `setAgentConnected(false)`, and pushes `agent_status connected:false` to browsers.

## Step 6 — BrowserHub (`server/services/browserHub.ts`)

Add to the `BrowserMessage` union (lines 7-13): `| { type: "agent_revoked"; agentId: string; gatewayId: string }`.

## Step 7 — API routes (`server/routes/api.ts` + `server/index.ts`)

**7a.** Thread deps: `registerApiRoutes(app, store, router, relayHub, browserHub)` — both instances exist before the call at index.ts:100.

**7b.** New zod schema:
```ts
const authorizeAgentSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  systemLabel: z.string().trim().min(1).max(120),
  systemType: z.enum(["laptop", "desktop", "server", "other"]),
  agentKind: z.string().trim().min(1).max(80).optional()
});
```

**7c.** Rename `POST /api/agents/pair` (api.ts:445-476) → **`POST /api/agents/authorize`**: parse new schema, pass metadata to `provisionAgentForOwner`, try/catch → 409 on revoked-gatewayId throw. One-time credentials response (env block, scripts, agentPrompt, plaintext secret shown once, secret/deliveryKey stripped from `agent`) unchanged — the strip spread auto-carries the new metadata fields.

**7d.** New **`POST /api/agents/:agentId/revoke`** (ownership-404 pattern of api.ts:412-422):
`store.revokeAgent(user.id, agentId)` → 404 if null; `relayHub.disconnectAgent(agent.id)`; `browserHub.sendToUser(user.id, { type: "agent_revoked", ... })`; return `{ agent }` (stripped, `revokedAt` set).

**7e.** Setup-script route (api.ts:478-507): 404 if `agent.revokedAt`; use `getAgentSecret(agent)` in both script builders (**critical** — otherwise new agents get `v1:` ciphertext in their `.env` and can never connect).

**7f.** `deliverMessageToAgents` (server/services/messageRouter.ts:111): `if (agent.revokedAt) continue;` (belt-and-braces; primary filter is Step 2d/2e).

**7g.** `/api/me` and `GET /api/agents`: no query change — revoked agents stay listed for the badge UI.

## Step 8 — Web API client (`web/src/lib/api.ts`)

Replace `createAgentPairing` (lines 49-65) with `authorizeAgent(input: { displayName; systemLabel; systemType; agentKind? })` → `POST /api/agents/authorize` (same response type + new agent fields); add `revokeAgent(agentId)` → `POST /api/agents/${agentId}/revoke`.

## Step 9 — UI (`web/src/App.tsx`, `web/src/styles.css`)

**9a.** `type Authorization = Awaited<ReturnType<typeof api.authorizeAgent>>` (App.tsx:9 area).

**9b.** Rework `ConnectAgentPanel` (App.tsx:89-168) → **Authorizations manager**:
- Header: eyebrow "Agents", h2 "Authorized Agents", button **"Authorize Agent"** toggling an inline form.
- DAC copy: *"You authorize an agent once. It can reconnect any time — whether or not you are online — until you revoke it. Credentials are shown a single time below."*
- Form (`.stack`, pattern AccessPanel App.tsx:214-217): agent name, system label ("e.g. Office desktop"), systemType select (laptop/desktop/server/other), optional agent kind. Submit → `api.authorizeAgent` → keep the existing one-time credentials `command-stack` block (lines 129-148) **unchanged**.
- List: replace `agent-pill` rows with `.compact-list` articles (pattern AccessPanel lines 226-246): avatar initials, name, `<small>` with systemLabel/systemType/authorized date/last seen, systemType `.badge`, `.status-dot(.online)`, and per row: **Revoke** button (with `window.confirm`; then `api.revokeAgent` + refetch) or `.badge.warning` "Revoked". `SetupScriptLinks` only for non-revoked. Grey revoked rows via `className="revoked"`.

**9c.** styles.css: `.compact-list article.revoked, .agent-tile.revoked { opacity: 0.55; }`.

**9d.** WS handler (App.tsx:668-689): on `agent_revoked`, map local agents state to set `revokedAt` + null `connectedAt` (socket-close side already emits the handled `agent_status`).

**9e.** Dashboard: filter revoked from tiles (`agents.filter(a => !a.revokedAt).slice(0, 6)`); show `systemLabel` in `agent-tile`. Update Agents `PageHeader` subtitle: "Authorize agents to connect from your devices, and revoke access at any time."

**9f.** `RelaysView` (web/src/components/relays/RelaysView.tsx): no logic change (renders connected agents; revoke closes the socket). Optional: pass `systemLabel` to the node subtitle if RelayNode has a slot.

## Step 10 — E2E (`scripts/e2e-relay.mjs`)

Update `createPairing` → `/api/agents/authorize` with `{ displayName, systemLabel: "e2e-runner", systemType: "server" }` (**must land in the same change as the rename**). Append revoke scenario: revoke via API → expect 200 with `revokedAt`; assert live socket closes with code **4403**; fresh connect with same credentials → 401 upgrade rejection; channel message still delivered to other agents; re-enroll with revoked gatewayId → 403 (resurrection guard).

## Implementation order
Types → schema/store → crypto → provisioning (server compiles at each point) → relayHub → browserHub → routes + index wiring → web client → UI/CSS → e2e.

## Verification
```
npm run typecheck && npm run build
npm run dev                       # memory store; founder key printed in logs
E2E_ACCESS_KEY=<key> E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```
Manual: sign in → Authorize Agent (name/label/type/kind) → one-time credentials shown, row appears with badge + authorized date → connect a simulated agent (reuse `RelayClient` from e2e script) → row/dashboard flip online live → **Revoke** → socket closes 4403, row greys with "Revoked" without refresh, dashboard tile disappears → reconnect attempt → 401 → setup-script URL for revoked agent → 404 → new channel message creates no delivery rows for it.

Edge cases: legacy plaintext-secret row still connects (helper fallback) while new rows store `v1:` ciphertext; hand-minted `exp=0` token now rejected; MemoryStore full-flow parity (no DATABASE_URL); Postgres migration on existing DB boots and old rows get nulls; revoked agent's pre-existing queued deliveries remain orphaned (acceptable, note as deferred cleanup).

## Gotchas
1. The `alter table` migrations must live inside the single `schema` template string (one `pool.query`), plus mirror columns in the create-table block for fresh installs.
2. Both Store impls change together or the no-DATABASE_URL dev path breaks.
3. NodeNext ESM `.js` import suffixes in all new server imports.
4. Pg `createAgent` upsert-with-where returns zero rows on the revoked path — must throw, and `RelayHub.enroll` must catch (→ 403), or the enroll request dies unhandled.
5. Don't replace the `({ secret, deliveryKey, ...safe })` spreads with explicit field lists — they auto-carry the new metadata.
6. `disconnectAgent` must NOT duplicate `onSocketClose` cleanup (double-broadcast).
7. Setup-script route must decrypt via `getAgentSecret` — the e2e reconnect test won't catch a ciphertext-in-env bug because it uses the authorize response secret.

## Critical files
- `server/db/store.ts` · `server/routes/api.ts` · `server/relay/relayHub.ts` · `server/services/agentProvisioning.ts` · `web/src/App.tsx`
- Supporting: `server/index.ts`, `server/crypto.ts`, `server/services/browserHub.ts`, `server/services/messageRouter.ts`, `server/types.ts`, `web/src/lib/api.ts`, `web/src/types.ts`, `web/src/styles.css`, `scripts/e2e-relay.mjs`