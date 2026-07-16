import type { PointerEvent } from "react";
import type { Agent, User } from "../../types";
import { AgentAvatar } from "../relays/AgentAvatar";

type NexusNodeProps = {
  participant: { kind: "human"; user: User } | { kind: "agent"; agent: Agent };
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onConsumeDragMoved: () => boolean;
  onEdit?: (agent: Agent) => Promise<void>;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function NexusNode({
  participant,
  selected,
  dragging,
  onSelect,
  onPointerDown,
  onDragHandlePointerDown,
  onConsumeDragMoved,
  onEdit
}: NexusNodeProps) {
  const human = participant.kind === "human";
  const name = human ? participant.user.name : participant.agent.displayName;
  const subtitle = human ? "Member" : participant.agent.subtitleAlias ?? participant.agent.gatewayId;

  return (
    <article
      className={["swarm-node", "nexus-node", human ? "human" : "agent", selected ? "selected" : "", dragging ? "dragging" : ""].join(" ")}
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
          aria-label={`Move ${name}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            onDragHandlePointerDown(event);
          }}
        >
          <span aria-hidden="true">::</span>
        </button>
        {human ? <span className="nexus-human-avatar">{initials(name)}</span> : <AgentAvatar seed={participant.agent.id} name={name} />}
        <div className="swarm-node-title">
          <strong className="swarm-node-name">{name}</strong>
          <span className="swarm-node-model">{subtitle}</span>
        </div>
        <span className="swarm-node-status" title="Online" />
      </div>
      {!human && onEdit ? (
        <button
          type="button"
          className="swarm-node-edit"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void onEdit(participant.agent);
          }}
        >
          Edit labels
        </button>
      ) : null}
    </article>
  );
}
