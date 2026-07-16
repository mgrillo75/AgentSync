import type { IncomingMessage } from "node:http";
import { parseCookie } from "cookie";
import type { WebSocket } from "ws";
import { sha256 } from "../crypto.js";
import type { Store } from "../db/store.js";

type BrowserMessage =
  | { type: "agent_status"; agentId: string; gatewayId: string; connected: boolean }
  | { type: "agent_revoked"; agentId: string; gatewayId: string }
  | { type: "message"; channelId: string; message: unknown }
  | { type: "message_updated"; channelId: string; message: unknown }
  | { type: "typing"; channelId: string; agentId: string }
  | { type: "channel"; channel: unknown }
  | { type: "system"; message: string };

export class BrowserHub {
  private clients = new Map<string, Set<WebSocket>>();

  constructor(private store: Store) {}

  async authenticate(request: IncomingMessage): Promise<string | null> {
    const cookies = parseCookie(request.headers.cookie ?? "");
    const token = cookies.agentsync_session;
    if (!token) return null;
    const user = await this.store.getSessionUser(sha256(token));
    return user?.id ?? null;
  }

  addClient(userId: string, socket: WebSocket): void {
    const set = this.clients.get(userId) ?? new Set<WebSocket>();
    set.add(socket);
    this.clients.set(userId, set);
    socket.on("close", () => {
      set.delete(socket);
      if (set.size === 0) this.clients.delete(userId);
    });
  }

  sendToUser(userId: string, payload: BrowserMessage): void {
    const raw = JSON.stringify(payload);
    for (const socket of this.clients.get(userId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  }

  async broadcastChannel(channelId: string, payload: BrowserMessage): Promise<void> {
    const members = await this.store.getChannelMembers(channelId);
    const userIds = new Set<string>();
    for (const member of members) {
      if (member.memberKind === "user") {
        userIds.add(member.memberId);
      } else {
        const agent = await this.store.getAgentById(member.memberId);
        if (agent) userIds.add(agent.ownerUserId);
      }
    }
    for (const userId of userIds) this.sendToUser(userId, payload);
  }
}
