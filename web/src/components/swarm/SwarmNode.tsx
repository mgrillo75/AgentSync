import type { PointerEvent } from "react";
import type { LlmAgent } from "../../types";
import { AgentAvatar } from "./AgentAvatar";

function truncateModel(model: string): string {
  const name = model.split("/").at(-1) || model;
  return name.length > 28 ? `${name.slice(0, 26)}...` : name;
}

export function SwarmNode({
  agent,
  selected,
  dragging,
  onSelect,
  onDelete,
  onPointerDown,
  onDragHandlePointerDown,
  onConsumeDragMoved
}: {
  agent: LlmAgent;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onConsumeDragMoved: () => boolean;
}) {
  const tools = agent.tools.slice(0, 4);
  const hiddenTools = Math.max(0, agent.tools.length - tools.length);

  return (
    <article
      className={[
        "swarm-node",
        agent.role === "coordinator" ? "coordinator" : "worker",
        selected ? "selected" : "",
        dragging ? "dragging" : ""
      ].join(" ")}
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
          aria-label={`Move ${agent.name}`}
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
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
        <div className="swarm-node-title">
          <strong className="swarm-node-name">{agent.name}</strong>
          <span className="swarm-node-model">{truncateModel(agent.model)}</span>
        </div>
        <span className="swarm-node-status" title="Created" />
      </div>

      {agent.description ? <p className="swarm-node-desc">{agent.description}</p> : null}

      <div className="swarm-node-badges">
        <span className={`swarm-role-badge ${agent.role}`}>{agent.role}</span>
      </div>

      {agent.tools.length > 0 ? (
        <div className="swarm-node-tools">
          {tools.map((tool) => (
            <span className="swarm-tool-chip" key={tool}>
              {tool}
            </span>
          ))}
          {hiddenTools > 0 ? <span className="swarm-tool-chip muted">+{hiddenTools}</span> : null}
        </div>
      ) : null}

      {selected ? (
        <button
          type="button"
          className="swarm-node-delete"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      ) : null}
    </article>
  );
}
