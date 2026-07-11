# Rename Swarm → Relays and repurpose it to show externally-connected agents

## Context

The "Swarm" section currently renders `LlmAgent` records — coordinator/worker cards created manually through a "Create Agent" modal and stored in the `llm_agents` table. That creation flow is being retired. The section will be renamed **"Relays"** and repurposed to visualize the platform's *other* agent concept: external agents that pair with the platform and connect live over the relay WebSocket (`agents` table, `Agent` type — the same list the Dashboard and Agents sections already use).

Decisions confirmed with the user:
- **Node cards show what connected agents report today**: avatar, display name, gateway ID, online status. (No model/role/tools — external agents don't send that yet.)
- **Only currently-online agents render** — a node appears on WebSocket connect and disappears on disconnect.
- **Frontend-only cleanup** — the `/api/llm-agents` server routes, store methods, and `llm_agents` table stay untouched; only the UI stops using them.
- The page title/subtitle ("WAO Agents Orchestration" / "LLM agents coordinator-to-worker relationships.") is removed entirely.

## Changes

### 1. `web/src/App.tsx`
- **Line 18** (`navItems`): `label: "Swarm"` → `label: "Relays"`, `id: "swarm"` → `id: "relays"`, icon `"SW"` → `"RL"`.
- **Line 11** (`AppView` union): `"swarm"` → `"relays"`.
- **Lines 795–800** (view branch): change condition to `activeView === "relays"`, **delete the `<PageHeader …>` line** (removes title + subtitle; note: the "Live" pill is part of `PageHeader` and goes with it — connection status remains visible via the sidebar's "Network Active" footer), and render the reworked view as `<RelaysView agents={agents} />`. The `onGoToProviders` prop is dropped (it only served the create modal).
- App already holds live-updating `agents` state: `/api/me` populates it (line 645) and the browser WebSocket flips `connectedAt` on `agent_status` events (lines 670–678). **No new data plumbing is needed** — nodes appear/disappear in real time for free by passing `agents` down as a prop.

### 2. Rework `web/src/components/swarm/SwarmView.tsx` → `RelaysView`
Rename the component to `RelaysView` (keep it in `web/src/components/swarm/`, or rename the dir to `relays/` — cosmetic; do rename the dir for consistency since most files in it change anyway).

- **Data source**: delete the `llmAgents`/`providerKeys` state, `api.listLlmAgents()`/`api.listProviderKeys()` fetch, `reload`, `loading`, `createAgent`, `deleteAgent`, and `showCreate`. Instead accept `agents: Agent[]` as a prop and derive `const onlineAgents = agents.filter(a => a.connectedAt)`.
- **Layout**: `buildOrgTree`/`layoutTree` no longer apply (external agents have no `parentId`). Replace with a simple grid computed inline: `x = (i % cols) * (NODE_W + gap)`, `y = Math.floor(i / cols) * (NODE_H + gap)` (reuse `NODE_W`/`NODE_H` from `web/src/lib/swarmLayout.ts`). Keep node dragging via `useSwarmDrag`, but `onDrop` writes to a local `Map<string, {x,y}>` state override instead of calling `api.updateLlmAgent` (external `Agent`s have no persisted x/y).
- **Edges**: remove the `<SwarmEdge>` SVG layer and `collectEdges` — there is no hierarchy to draw.
- **Toolbar**: keep the counts block as `"{onlineAgents.length} agents connected"` (drop the provider-keys line); **remove the Create Agent button**; keep the `+` / `−` / `Fit` zoom controls and `useSwarmPanZoom` unchanged.
- **Empty state**: replace with `"No agents connected"` / `"Agents appear here when they connect to the platform."` — no button. Remove the `Loading swarm...` state (data comes from App, no fetch).
- **Node rendering**: map over `onlineAgents` instead of `llmAgents`.

### 3. Rework `SwarmNode.tsx` → `RelayNode`
Adapt the card to the `Agent` type (`web/src/types.ts:18-26`): keep `AgentAvatar` (seed from `agent.id`), show `displayName` as the name and `gatewayId` where the model string was; keep the status dot but drive it from `agent.connectedAt` (green/"Online") instead of the static "Created" dot. Remove the role badge, description, tools chips, and the delete button. Keep the existing `.swarm-*` CSS classes so `web/src/styles.css` needs no changes (optionally rename classes later).

### 4. Delete now-unused frontend files
- `web/src/components/swarm/CreateAgentPanel.tsx` (the modal — also removes the user-facing "Swarm" eyebrow text).
- `web/src/components/swarm/SwarmEdge.tsx`.
- In `web/src/lib/api.ts` (lines 40–64): remove `listLlmAgents`, `createLlmAgent`, `updateLlmAgent`, `deleteLlmAgent` client methods (server routes stay).
- In `web/src/lib/swarmLayout.ts`: `buildOrgTree`/`layoutTree`/`SwarmTreeNode` become unused — trim to just the `NODE_W`/`NODE_H` constants (or move those into the view and delete the file).
- The `LlmAgent`/`LlmAgentRole` types in `web/src/types.ts` become unused on the frontend; remove them (server keeps its own copy in `server/types.ts`).

### Kept as-is
- `useSwarmPanZoom.ts`, `useSwarmDrag.ts`, `AgentAvatar.tsx`, all `.swarm-*` styles in `web/src/styles.css`.
- All server code: `server/routes/api.ts` llm-agent routes, `server/db/store.ts`, `llm_agents` table, and the entire relay stack (`server/relay/relayHub.ts` already broadcasts `agent_status` on connect/disconnect — this is what drives the live nodes).

## Verification
1. Start the dev servers (Fastify backend + Vite `web/`) via the browser preview.
2. Sidebar shows **Relays** (not Swarm); clicking it shows: no title/subtitle header, no Create Agent buttons anywhere, toolbar with `0 agents connected` + zoom controls, and the "No agents connected" empty state.
3. Type-check/build the frontend (`npm run build` or `tsc` in `web/`) to confirm no dangling references to removed components/API methods.
4. Live-node behavior: pair and connect an external agent (Agents section → pairing token → connect a test agent to the relay WebSocket), and confirm a node card appears on the Relays canvas with its name/gateway ID and green dot; disconnect it and confirm the node disappears. If no real agent is handy, a minimal WebSocket client script (bearer-token auth per `relayHub.handleUpgrade`) can simulate the connection.
5. Confirm other sections (Dashboard, Agents, Chat, Providers) still render and the Providers page is unaffected.