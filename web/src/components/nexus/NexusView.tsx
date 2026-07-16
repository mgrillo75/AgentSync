import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { NODE_H, NODE_W } from "../../lib/swarmLayout";
import type { Agent, NexusGraph } from "../../types";
import { useSwarmDrag } from "../relays/useSwarmDrag";
import { useSwarmPanZoom } from "../relays/useSwarmPanZoom";
import { NexusNode } from "./NexusNode";

const RADIUS = 280;

function graphId(kind: "user" | "agent", id: string) {
  return `${kind}:${id}`;
}

function positionBounds(positions: Map<string, { x: number; y: number }>) {
  const values = [...positions.values()];
  if (values.length === 0) return null;
  return {
    minX: Math.min(...values.map((position) => position.x)),
    minY: Math.min(...values.map((position) => position.y)),
    maxX: Math.max(...values.map((position) => position.x + NODE_W)),
    maxY: Math.max(...values.map((position) => position.y + NODE_H))
  };
}

export function NexusView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialFitRef = useRef(false);
  const [graph, setGraph] = useState<NexusGraph | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positionOverrides, setPositionOverrides] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  const { transform, handlers: panHandlers, zoomIn, zoomOut, fitToScreen } = useSwarmPanZoom();

  const reload = useCallback(async () => {
    try {
      setGraph(await api.nexusGraph());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Nexus.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const participants = useMemo(() => {
    if (!graph) return [];
    return [
      { id: graphId("user", graph.member.id), kind: "human" as const, user: graph.member },
      ...graph.agents.map((agent) => ({ id: graphId("agent", agent.id), kind: "agent" as const, agent }))
    ];
  }, [graph]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    participants.forEach((participant, index) => {
      const override = positionOverrides.get(participant.id);
      if (override) return map.set(participant.id, override);
      if (index === 0) return map.set(participant.id, { x: 0, y: 0 });
      const agentCount = Math.max(1, participants.length - 1);
      const angle = ((index - 1) / agentCount) * Math.PI * 2;
      map.set(participant.id, { x: Math.cos(angle) * RADIUS, y: Math.sin(angle) * RADIUS });
    });
    return map;
  }, [participants, positionOverrides]);

  const fitCurrentView = useCallback(() => {
    const bounds = positionBounds(positions);
    const element = containerRef.current;
    if (bounds && element) fitToScreen(bounds, { width: element.clientWidth, height: element.clientHeight });
  }, [fitToScreen, positions]);

  useEffect(() => {
    if (didInitialFitRef.current || positions.size === 0) return;
    didInitialFitRef.current = true;
    fitCurrentView();
  }, [fitCurrentView, positions.size]);

  const { dragState, startDrag, moveDrag, endDrag, consumeLastDragMoved } = useSwarmDrag({
    transform,
    containerRef,
    getPosition: useCallback((id: string) => positions.get(id) ?? null, [positions]),
    onDrop: useCallback((id: string, x: number, y: number) => {
      setPositionOverrides((current) => new Map(current).set(id, { x, y }));
    }, [])
  });

  const renderPositions = useMemo(() => {
    const map = new Map(positions);
    if (dragState) map.set(dragState.agentId, { x: dragState.currentX, y: dragState.currentY });
    return map;
  }, [dragState, positions]);

  const editAgent = useCallback(async (agent: Agent) => {
    const displayName = window.prompt("Agent display name", agent.displayName);
    if (displayName === null || !displayName.trim()) return;
    const subtitleAlias = window.prompt("Nexus subtitle (leave blank to show gateway ID)", agent.subtitleAlias ?? "");
    if (subtitleAlias === null) return;
    await api.updateAgent(agent.id, { displayName: displayName.trim(), subtitleAlias: subtitleAlias.trim() || null });
    await reload();
  }, [reload]);

  return (
    <section className="swarm-shell nexus-shell">
      <div className="swarm-toolbar">
        <div><strong>{graph?.agents.length ?? 0} agents in Nexus</strong><small>Recent communication links</small></div>
        <div className="swarm-toolbar-actions">
          <button type="button" className="secondary icon-button" onClick={zoomIn}>+</button>
          <button type="button" className="secondary icon-button" onClick={zoomOut}>-</button>
          <button type="button" className="secondary" onClick={fitCurrentView}>Fit</button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div
        ref={containerRef}
        className="swarm-canvas"
        {...panHandlers}
        onPointerMove={(event) => { panHandlers.onPointerMove(event); moveDrag(event); }}
        onPointerUp={(event) => { panHandlers.onPointerUp(event); endDrag(); }}
        onClick={() => setSelectedId(null)}
      >
        <svg className="swarm-grid" aria-hidden="true"><defs><pattern id="nexus-grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}><circle cx="20" cy="20" r="0.7" fill="rgba(255,255,255,0.16)" /></pattern></defs><rect width="100%" height="100%" fill="url(#nexus-grid-pattern)" /></svg>
        <div className="swarm-layer" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
          <svg className="swarm-edges" aria-hidden="true">
            {graph?.links.map((link) => {
              const from = renderPositions.get(graphId(link.fromKind, link.fromId));
              const to = renderPositions.get(graphId(link.toKind, link.toId));
              if (!from || !to) return null;
              return <line key={`${link.fromKind}:${link.fromId}-${link.toKind}:${link.toId}`} className="nexus-edge" x1={from.x + NODE_W / 2} y1={from.y + NODE_H / 2} x2={to.x + NODE_W / 2} y2={to.y + NODE_H / 2} style={{ strokeWidth: Math.min(5, 1.5 + Math.log2(link.count + 1)) }} />;
            })}
          </svg>
          {participants.map((participant) => {
            const position = renderPositions.get(participant.id);
            if (!position) return null;
            return <div className="swarm-node-position" key={participant.id} style={{ left: position.x, top: position.y }}><NexusNode participant={participant} selected={selectedId === participant.id} dragging={dragState?.agentId === participant.id} onSelect={() => setSelectedId(participant.id)} onPointerDown={(event) => startDrag(event, participant.id)} onDragHandlePointerDown={(event) => startDrag(event, participant.id)} onConsumeDragMoved={consumeLastDragMoved} onEdit={participant.kind === "agent" ? editAgent : undefined} /></div>;
          })}
        </div>
      </div>
    </section>
  );
}
