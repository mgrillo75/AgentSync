import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NODE_H, NODE_W } from "../../lib/swarmLayout";
import { api } from "../../lib/api";
import type { Agent } from "../../types";
import { RelayNode } from "./RelayNode";
import { useSwarmDrag } from "./useSwarmDrag";
import { useSwarmPanZoom } from "./useSwarmPanZoom";

const GRID_GAP = 40;
const GRID_COLS = 3;

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

export function RelaysView({ agents, onAgentsChanged }: { agents: Agent[]; onAgentsChanged: () => Promise<void> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialFitRef = useRef(false);
  const [positionOverrides, setPositionOverrides] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { transform, handlers: panHandlers, zoomIn, zoomOut, fitToScreen } = useSwarmPanZoom();

  const onlineAgents = useMemo(() => agents.filter((agent) => agent.connectedAt), [agents]);

  const editAgent = useCallback(async (agent: Agent) => {
    const displayName = window.prompt("Agent display name", agent.displayName);
    if (displayName === null || !displayName.trim()) return;
    const subtitleAlias = window.prompt("Relays subtitle (leave blank to show gateway ID)", agent.subtitleAlias ?? "");
    if (subtitleAlias === null) return;
    await api.updateAgent(agent.id, { displayName: displayName.trim(), subtitleAlias: subtitleAlias.trim() || null });
    await onAgentsChanged();
  }, [onAgentsChanged]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    onlineAgents.forEach((agent, i) => {
      const override = positionOverrides.get(agent.id);
      map.set(
        agent.id,
        override ?? {
          x: (i % GRID_COLS) * (NODE_W + GRID_GAP),
          y: Math.floor(i / GRID_COLS) * (NODE_H + GRID_GAP)
        }
      );
    });
    return map;
  }, [onlineAgents, positionOverrides]);

  const fitCurrentView = useCallback(() => {
    const bounds = positionBounds(positions);
    const el = containerRef.current;
    if (!bounds || !el) return;
    fitToScreen(bounds, { width: el.clientWidth, height: el.clientHeight });
  }, [fitToScreen, positions]);

  useEffect(() => {
    if (didInitialFitRef.current || positions.size === 0) return;
    didInitialFitRef.current = true;
    fitCurrentView();
  }, [fitCurrentView, positions.size]);

  const getPosition = useCallback((agentId: string) => positions.get(agentId) ?? null, [positions]);

  const onDrop = useCallback((agentId: string, x: number, y: number) => {
    setPositionOverrides((prev) => {
      const next = new Map(prev);
      next.set(agentId, { x, y });
      return next;
    });
  }, []);

  const { dragState, startDrag, moveDrag, endDrag, consumeLastDragMoved } = useSwarmDrag({
    transform,
    containerRef,
    getPosition,
    onDrop
  });

  const renderPositions = useMemo(() => {
    const merged = new Map(positions);
    if (dragState) {
      merged.set(dragState.agentId, { x: dragState.currentX, y: dragState.currentY });
    }
    return merged;
  }, [dragState, positions]);

  return (
    <section className="swarm-shell">
      <div className="swarm-toolbar">
        <div>
          <strong>{onlineAgents.length} agents connected</strong>
        </div>
        <div className="swarm-toolbar-actions">
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
          {onlineAgents.map((agent) => {
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
                <RelayNode
                  agent={agent}
                  selected={selectedId === agent.id}
                  dragging={dragState?.agentId === agent.id}
                  onSelect={() => setSelectedId((current) => (current === agent.id ? null : agent.id))}
                  onPointerDown={(event) => startDrag(event, agent.id)}
                  onDragHandlePointerDown={(event) => startDrag(event, agent.id)}
                  onConsumeDragMoved={consumeLastDragMoved}
                  onEdit={editAgent}
                />
              </div>
            );
          })}
        </div>

        {onlineAgents.length === 0 ? (
          <div className="swarm-empty">
            <h3>No agents connected</h3>
            <p>Agents appear here when they connect to the platform.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
