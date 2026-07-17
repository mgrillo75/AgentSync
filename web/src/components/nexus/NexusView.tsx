import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { NODE_H, NODE_W } from "../../lib/swarmLayout";
import type { Agent, NexusGraph } from "../../types";
import { useSwarmDrag } from "../relays/useSwarmDrag";
import { useSwarmPanZoom } from "../relays/useSwarmPanZoom";
import { NexusNode, type NexusSendTarget } from "./NexusNode";

const RADIUS = 280;
const HUMAN_NODE_H = 170;
type Position = { x: number; y: number };

function graphId(kind: "user" | "agent", id: string) { return `${kind}:${id}`; }
function participantHeight(kind: "human" | "agent") { return kind === "human" ? HUMAN_NODE_H : NODE_H; }

function positionBounds(participants: Array<{ id: string; kind: "human" | "agent" }>, positions: Map<string, Position>) {
  const visible = participants.flatMap((participant) => {
    const position = positions.get(participant.id);
    return position ? [{ participant, position }] : [];
  });
  if (visible.length === 0) return null;
  return {
    minX: Math.min(...visible.map(({ position }) => position.x)),
    minY: Math.min(...visible.map(({ position }) => position.y)),
    maxX: Math.max(...visible.map(({ position }) => position.x + NODE_W)),
    maxY: Math.max(...visible.map(({ participant, position }) => position.y + participantHeight(participant.kind)))
  };
}

function borderPoint(from: Position, fromHeight: number, to: Position, toHeight: number) {
  const centerX = from.x + NODE_W / 2;
  const centerY = from.y + fromHeight / 2;
  const dx = to.x + NODE_W / 2 - centerX;
  const dy = to.y + toHeight / 2 - centerY;
  const scale = Math.min(dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx), dy === 0 ? Infinity : fromHeight / 2 / Math.abs(dy));
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

export function NexusView({ live, refreshSignal }: { live: boolean; refreshSignal: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialFitRef = useRef(false);
  const [graph, setGraph] = useState<NexusGraph | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positionOverrides, setPositionOverrides] = useState<Map<string, Position>>(() => new Map());
  const { transform, handlers: panHandlers, zoomIn, zoomOut, fitToScreen } = useSwarmPanZoom();

  const reload = useCallback(async () => {
    try { setGraph(await api.nexusGraph()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Nexus."); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (refreshSignal === 0) return;
    const timer = window.setTimeout(() => void reload(), 400);
    return () => window.clearTimeout(timer);
  }, [refreshSignal, reload]);

  const participants = useMemo(() => graph ? [
    { id: graphId("user", graph.member.id), kind: "human" as const, user: graph.member },
    ...graph.agents.map((agent) => ({ id: graphId("agent", agent.id), kind: "agent" as const, agent }))
  ] : [], [graph]);

  const positions = useMemo(() => {
    const map = new Map<string, Position>();
    participants.forEach((participant, index) => {
      const override = positionOverrides.get(participant.id);
      if (override) return map.set(participant.id, override);
      if (index === 0) return map.set(participant.id, { x: 0, y: 0 });
      const angle = ((index - 1) / Math.max(1, participants.length - 1)) * Math.PI * 2;
      map.set(participant.id, { x: Math.cos(angle) * RADIUS, y: HUMAN_NODE_H / 2 + Math.sin(angle) * RADIUS - NODE_H / 2 });
    });
    return map;
  }, [participants, positionOverrides]);

  const fitCurrentView = useCallback(() => {
    const bounds = positionBounds(participants, positions);
    const element = containerRef.current;
    if (bounds && element) fitToScreen(bounds, { width: element.clientWidth, height: element.clientHeight });
  }, [fitToScreen, participants, positions]);
  useEffect(() => { if (!didInitialFitRef.current && positions.size > 0) { didInitialFitRef.current = true; fitCurrentView(); } }, [fitCurrentView, positions.size]);

  const { dragState, startDrag, moveDrag, endDrag, consumeLastDragMoved } = useSwarmDrag({
    transform, containerRef,
    getPosition: useCallback((id: string) => positions.get(id) ?? null, [positions]),
    onDrop: useCallback((id: string, x: number, y: number) => setPositionOverrides((current) => new Map(current).set(id, { x, y })), [])
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

  const human = participants.find((participant) => participant.kind === "human");
  const sendTargets = useMemo<NexusSendTarget[]>(() => {
    if (!human) return [];
    const humanPosition = renderPositions.get(human.id);
    if (!humanPosition) return [];
    return participants.flatMap((participant) => {
      if (participant.kind !== "agent") return [];
      const agentPosition = renderPositions.get(participant.id);
      if (!agentPosition) return [];
      const point = borderPoint(humanPosition, HUMAN_NODE_H, agentPosition, NODE_H);
      return [{ agentId: participant.agent.id, name: participant.agent.displayName, x: point.x - humanPosition.x, y: point.y - humanPosition.y }];
    });
  }, [human, participants, renderPositions]);

  const send = useCallback(async (agentId: string, content: string) => {
    try { setError(""); await api.sendToAgent(agentId, content); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send message."); throw cause; }
  }, [reload]);

  return (
    <section className="swarm-shell nexus-shell">
      <div className="swarm-toolbar">
        <div><strong>{graph?.agents.length ?? 0} agents in Nexus</strong><span className={live ? "badge success" : "badge"}>{live ? "Live" : "Idle"}</span></div>
        <div className="swarm-toolbar-actions"><button type="button" className="secondary icon-button" onClick={zoomIn}>+</button><button type="button" className="secondary icon-button" onClick={zoomOut}>-</button><button type="button" className="secondary" onClick={fitCurrentView}>Fit</button></div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div ref={containerRef} className="swarm-canvas" {...panHandlers} onPointerMove={(event) => { panHandlers.onPointerMove(event); moveDrag(event); }} onPointerUp={(event) => { panHandlers.onPointerUp(event); endDrag(); }} onClick={() => setSelectedId(null)}>
        <svg className="swarm-grid" aria-hidden="true"><defs><pattern id="nexus-grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}><circle cx="20" cy="20" r="0.7" fill="rgba(255,255,255,0.16)" /></pattern></defs><rect width="100%" height="100%" fill="url(#nexus-grid-pattern)" /></svg>
        <div className="swarm-layer" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
          <svg className="swarm-edges" aria-hidden="true">{graph?.links.map((link) => {
            const fromParticipant = participants.find((item) => item.id === graphId(link.fromKind, link.fromId));
            const toParticipant = participants.find((item) => item.id === graphId(link.toKind, link.toId));
            const from = fromParticipant && renderPositions.get(fromParticipant.id);
            const to = toParticipant && renderPositions.get(toParticipant.id);
            if (!fromParticipant || !toParticipant || !from || !to) return null;
            const start = borderPoint(from, participantHeight(fromParticipant.kind), to, participantHeight(toParticipant.kind));
            const end = borderPoint(to, participantHeight(toParticipant.kind), from, participantHeight(fromParticipant.kind));
            return <line key={`${link.fromKind}:${link.fromId}-${link.toKind}:${link.toId}`} className="nexus-edge" x1={start.x} y1={start.y} x2={end.x} y2={end.y} style={{ strokeWidth: Math.min(5, 1.5 + Math.log2(link.count + 1)) }} />;
          })}</svg>
          {participants.map((participant) => {
            const position = renderPositions.get(participant.id);
            if (!position) return null;
            return <div className="swarm-node-position" key={participant.id} style={{ left: position.x, top: position.y }}><NexusNode participant={participant} selected={selectedId === participant.id} dragging={dragState?.agentId === participant.id} onSelect={() => setSelectedId(participant.id)} onPointerDown={(event) => startDrag(event, participant.id)} onDragHandlePointerDown={(event) => startDrag(event, participant.id)} onConsumeDragMoved={consumeLastDragMoved} onEdit={participant.kind === "agent" ? editAgent : undefined} sendTargets={participant.kind === "human" ? sendTargets : undefined} onSend={participant.kind === "human" ? send : undefined} /></div>;
          })}
        </div>
      </div>
    </section>
  );
}
