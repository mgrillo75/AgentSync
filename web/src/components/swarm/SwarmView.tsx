import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { buildOrgTree, layoutTree, NODE_H, NODE_W, type SwarmTreeNode } from "../../lib/swarmLayout";
import type { LlmAgent, ProviderKey } from "../../types";
import { CreateAgentPanel } from "./CreateAgentPanel";
import { SwarmEdge } from "./SwarmEdge";
import { SwarmNode } from "./SwarmNode";
import { useSwarmDrag } from "./useSwarmDrag";
import { useSwarmPanZoom } from "./useSwarmPanZoom";

function collectEdges(roots: SwarmTreeNode[]) {
  const edges: Array<{ parentId: string; childId: string }> = [];
  function walk(node: SwarmTreeNode) {
    for (const child of node.children) {
      edges.push({ parentId: node.agent.id, childId: child.agent.id });
      walk(child);
    }
  }
  for (const root of roots) walk(root);
  return edges;
}

function positionBounds(positions: Map<string, { x: number; y: number }>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + NODE_W);
    maxY = Math.max(maxY, pos.y + NODE_H);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function SwarmView({ onGoToProviders }: { onGoToProviders: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialFitRef = useRef(false);
  const [llmAgents, setLlmAgents] = useState<LlmAgent[]>([]);
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { transform, handlers: panHandlers, zoomIn, zoomOut, fitToScreen } = useSwarmPanZoom();

  const reload = useCallback(async () => {
    const [agentsResult, keysResult] = await Promise.all([api.listLlmAgents(), api.listProviderKeys()]);
    setLlmAgents(agentsResult.llmAgents);
    setProviderKeys(keysResult.providerKeys);
  }, []);

  useEffect(() => {
    void reload()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load swarm."))
      .finally(() => setLoading(false));
  }, [reload]);

  const roots = useMemo(() => buildOrgTree(llmAgents), [llmAgents]);
  const positions = useMemo(() => {
    const autoLayout = layoutTree(roots);
    const merged = new Map(autoLayout);
    for (const agent of llmAgents) {
      if (agent.x != null && agent.y != null) {
        merged.set(agent.id, { x: agent.x, y: agent.y });
      }
    }
    return merged;
  }, [llmAgents, roots]);
  const edges = useMemo(() => collectEdges(roots), [roots]);

  const visiblePositions = useMemo(() => {
    const merged = new Map(positions);
    return merged;
  }, [positions]);

  const fitCurrentView = useCallback(() => {
    const bounds = positionBounds(visiblePositions);
    const el = containerRef.current;
    if (!bounds || !el) return;
    fitToScreen(bounds, { width: el.clientWidth, height: el.clientHeight });
  }, [fitToScreen, visiblePositions]);

  useEffect(() => {
    if (didInitialFitRef.current || visiblePositions.size === 0) return;
    didInitialFitRef.current = true;
    fitCurrentView();
  }, [fitCurrentView, visiblePositions.size]);

  const getPosition = useCallback((agentId: string) => visiblePositions.get(agentId) ?? null, [visiblePositions]);

  const onDrop = useCallback(
    (agentId: string, x: number, y: number) => {
      const previous = llmAgents;
      setLlmAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, x, y } : agent)));
      void api.updateLlmAgent(agentId, { x, y }).catch((err) => {
        setLlmAgents(previous);
        setError(err instanceof Error ? err.message : "Could not save position.");
      });
    },
    [llmAgents]
  );

  const { dragState, startDrag, moveDrag, endDrag, consumeLastDragMoved } = useSwarmDrag({
    transform,
    containerRef,
    getPosition,
    onDrop
  });

  const renderPositions = useMemo(() => {
    const merged = new Map(visiblePositions);
    if (dragState) {
      merged.set(dragState.agentId, { x: dragState.currentX, y: dragState.currentY });
    }
    return merged;
  }, [dragState, visiblePositions]);

  async function createAgent(input: Parameters<typeof api.createLlmAgent>[0]) {
    const result = await api.createLlmAgent(input);
    setLlmAgents((current) => [...current, result.llmAgent]);
    didInitialFitRef.current = false;
  }

  async function deleteAgent(agentId: string) {
    setError("");
    try {
      await api.deleteLlmAgent(agentId);
      setSelectedId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete agent.");
    }
  }

  return (
    <section className="swarm-shell">
      <div className="swarm-toolbar">
        <div>
          <strong>{llmAgents.length} agents</strong>
          <small>{providerKeys.length} provider keys</small>
        </div>
        <div className="swarm-toolbar-actions">
          <button type="button" onClick={() => setShowCreate(true)}>
            Create Agent
          </button>
          <button type="button" className="secondary icon-button" title="Zoom in" onClick={zoomIn}>
            +
          </button>
          <button type="button" className="secondary icon-button" title="Zoom out" onClick={zoomOut}>
            -
          </button>
          <button type="button" className="secondary" onClick={fitCurrentView}>
            Fit
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div
        ref={containerRef}
        className="swarm-canvas"
        {...panHandlers}
        onPointerMove={(event) => {
          panHandlers.onPointerMove(event);
          moveDrag(event);
        }}
        onPointerUp={(event) => {
          panHandlers.onPointerUp(event);
          endDrag();
        }}
        onClick={() => setSelectedId(null)}
      >
        <svg className="swarm-grid" aria-hidden="true">
          <defs>
            <pattern
              id="swarm-grid-pattern"
              width={40}
              height={40}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}
            >
              <circle cx="20" cy="20" r="0.7" fill="rgba(255,255,255,0.16)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#swarm-grid-pattern)" />
        </svg>

        <div
          className="swarm-layer"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
          }}
        >
          <svg className="swarm-edges" aria-hidden="true">
            {edges.map(({ parentId, childId }) => {
              const parent = renderPositions.get(parentId);
              const child = renderPositions.get(childId);
              if (!parent || !child) return null;
              return (
                <SwarmEdge
                  key={`${parentId}:${childId}`}
                  x1={parent.x + NODE_W / 2}
                  y1={parent.y + NODE_H}
                  x2={child.x + NODE_W / 2}
                  y2={child.y}
                />
              );
            })}
          </svg>

          {llmAgents.map((agent) => {
            const position = renderPositions.get(agent.id);
            if (!position) return null;
            return (
              <div
                className="swarm-node-position"
                key={agent.id}
                style={{
                  left: position.x,
                  top: position.y,
                  transition: dragState?.agentId === agent.id ? "none" : "left 180ms ease, top 180ms ease"
                }}
              >
                <SwarmNode
                  agent={agent}
                  selected={selectedId === agent.id}
                  dragging={dragState?.agentId === agent.id}
                  onSelect={() => setSelectedId((current) => (current === agent.id ? null : agent.id))}
                  onDelete={() => void deleteAgent(agent.id)}
                  onPointerDown={(event) => startDrag(event, agent.id)}
                  onDragHandlePointerDown={(event) => startDrag(event, agent.id)}
                  onConsumeDragMoved={consumeLastDragMoved}
                />
              </div>
            );
          })}
        </div>

        {!loading && llmAgents.length === 0 ? (
          <div className="swarm-empty">
            <h3>No swarm agents yet</h3>
            <p>Create a coordinator or worker to start building the graph.</p>
            <button type="button" onClick={() => setShowCreate(true)}>
              Create Agent
            </button>
          </div>
        ) : null}

        {loading ? <div className="swarm-empty">Loading swarm...</div> : null}
      </div>

      {showCreate ? (
        <CreateAgentPanel
          agents={llmAgents}
          providerKeys={providerKeys}
          onClose={() => setShowCreate(false)}
          onCreate={createAgent}
          onGoToProviders={onGoToProviders}
        />
      ) : null}
    </section>
  );
}
