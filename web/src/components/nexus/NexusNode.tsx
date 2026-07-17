import { useState, type PointerEvent } from "react";
import type { Agent, User } from "../../types";
import { AgentAvatar } from "../relays/AgentAvatar";

export type NexusSendTarget = { agentId: string; name: string; x: number; y: number };

type NexusNodeProps = {
  participant: { kind: "human"; user: User } | { kind: "agent"; agent: Agent };
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLElement>) => void;
  onConsumeDragMoved: () => boolean;
  onEdit?: (agent: Agent) => Promise<void>;
  sendTargets?: NexusSendTarget[];
  onSend?: (agentId: string, content: string) => Promise<void>;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function NexusNode({
  participant, selected, dragging, onSelect, onPointerDown, onDragHandlePointerDown,
  onConsumeDragMoved, onEdit, sendTargets = [], onSend
}: NexusNodeProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const human = participant.kind === "human";
  const name = human ? participant.user.name : participant.agent.displayName;
  const subtitle = human ? "Member" : participant.agent.subtitleAlias ?? participant.agent.gatewayId;

  async function send(agentId: string) {
    const content = draft.trim();
    if (!content || sending || !onSend) return;
    setSending(true);
    try {
      await onSend(agentId, content);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <article
      className={["swarm-node", "nexus-node", human ? "human" : "agent", selected ? "selected" : "", dragging ? "dragging" : ""].join(" ")}
      onPointerDown={onPointerDown}
      onClick={(event) => { event.stopPropagation(); if (!onConsumeDragMoved()) onSelect(); }}
    >
      <div className="swarm-node-main">
        <button type="button" className="swarm-node-handle" aria-label={`Move ${name}`} onPointerDown={(event) => { event.stopPropagation(); onDragHandlePointerDown(event); }}>
          <span aria-hidden="true">::</span>
        </button>
        {human ? <span className="nexus-human-avatar">{initials(name)}</span> : <AgentAvatar seed={participant.agent.id} name={name} />}
        <div className="swarm-node-title"><strong className="swarm-node-name">{name}</strong><span className="swarm-node-model">{subtitle}</span></div>
        <span className="swarm-node-status" title="Online" />
      </div>

      {human ? (
        <div className="nexus-composer" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={sendTargets.length === 0 ? "No connected agents" : "Message an agent..."}
            disabled={sendTargets.length === 0 || sending}
            aria-label="Message to agent"
            rows={3}
            wrap="soft"
          />
        </div>
      ) : null}

      {human ? sendTargets.map((target) => (
        <button type="button" className="nexus-send-btn" style={{ left: target.x, top: target.y }} title={`Send to ${target.name}`} aria-label={`Send to ${target.name}`} disabled={!draft.trim() || sending} key={target.agentId} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void send(target.agentId); }}>
          <span aria-hidden="true">➤</span>
        </button>
      )) : null}

      {!human && onEdit ? (
        <button type="button" className="swarm-node-edit" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void onEdit(participant.agent); }}>Edit labels</button>
      ) : null}
    </article>
  );
}
