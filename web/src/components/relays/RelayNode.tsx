import type { PointerEvent } from "react";
import type { Agent } from "../../types";
import { AgentAvatar } from "./AgentAvatar";

export function RelayNode({
  agent,
  selected,
  dragging,
  onSelect,
  onPointerDown,
  onDragHandlePointerDown,
  onConsumeDragMoved
}: {
  agent: Agent;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onConsumeDragMoved: () => boolean;
}) {
  const online = Boolean(agent.connectedAt);

  return (
    <article
      className={["swarm-node", selected ? "selected" : "", dragging ? "dragging" : ""].join(" ")}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.stopPropagation();
        if (onConsumeDragMoved()) return;
        onSelect();
      }}
    >
      <div className="swarm-node-main">
        <button
          type="button"
          className="swarm-node-handle"
          aria-label={`Move ${agent.displayName}`}
          title="Move"
          onPointerDown={(event) => {
            event.stopPropagation();
            onDragHandlePointerDown(event);
          }}
        >
          <svg width="6" height="10" viewBox="0 0 6 10" aria-hidden="true">
            <circle cx="1.5" cy="1.5" r="1" fill="currentColor" />
            <circle cx="4.5" cy="1.5" r="1" fill="currentColor" />
            <circle cx="1.5" cy="5" r="1" fill="currentColor" />
            <circle cx="4.5" cy="5" r="1" fill="currentColor" />
            <circle cx="1.5" cy="8.5" r="1" fill="currentColor" />
            <circle cx="4.5" cy="8.5" r="1" fill="currentColor" />
          </svg>
        </button>
        <AgentAvatar seed={agent.id} name={agent.displayName} />
        <div className="swarm-node-title">
          <strong className="swarm-node-name">{agent.displayName}</strong>
          <span className="swarm-node-model">{agent.gatewayId}</span>
        </div>
        <span
          className="swarm-node-status"
          title={online ? "Online" : "Offline"}
          style={
            online
              ? { background: "var(--green)", boxShadow: "0 0 12px rgba(52, 211, 153, 0.55)" }
              : undefined
          }
        />
      </div>
    </article>
  );
}
