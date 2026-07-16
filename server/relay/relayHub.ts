import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { sha256, verifyRelayUpgradeToken } from "../crypto.js";
import type { Store } from "../db/store.js";
import type { BrowserHub } from "../services/browserHub.js";
import { getAgentSecret, provisionAgentForOwner } from "../services/agentProvisioning.js";
import type { AgentDelivery } from "../services/messageRouter.js";
import type { Agent, RelayInboundEvent } from "../types.js";

type RelayFrame = Record<string, any>;

type RelayConnection = {
  agent: Agent;
  ws: WebSocket;
  buffer: string;
  descriptorSent: boolean;
};

const descriptor = {
  contract_version: 1,
  platform: "agentsync",
  label: "AgentSync",
  max_message_length: 4096,
  supports_draft_streaming: false,
  supports_edit: true,
  supports_threads: false,
  markdown_dialect: "markdown",
  len_unit: "chars",
  emoji: "AS",
  platform_hint: "AgentSync shared channel",
  pii_safe: false
};

function rejectUpgrade(socket: Duplex, status = 401, reason = "Unauthorized"): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function bearerToken(request: IncomingMessage): string | null {
  const raw = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(raw) ? raw[0] : raw);
  return match?.[1] ?? null;
}

function peekGatewayId(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    parts.pop();
    parts.pop();
    return parts.join(":") || null;
  } catch {
    return null;
  }
}

function sendFrame(ws: WebSocket, frame: RelayFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(`${JSON.stringify(frame)}\n`);
  }
}

export class RelayHub implements AgentDelivery {
  readonly wss = new WebSocketServer({ noServer: true });
  private connections = new Map<string, RelayConnection>();
  private router: { routeAgentMessage(input: { channelId: string; agent: Agent; content: string; replyToMessageId?: string | null }): Promise<{ message: { id: string }; throttled: boolean }> } | null = null;

  constructor(
    private store: Store,
    private browserHub: BrowserHub
  ) {
    this.wss.on("connection", (ws, request) => {
      void this.onConnection(ws, request);
    });
  }

  setRouter(router: RelayHub["router"]): void {
    this.router = router;
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const token = bearerToken(request);
    if (!token) return rejectUpgrade(socket);

    const gatewayId = peekGatewayId(token);
    if (!gatewayId) return rejectUpgrade(socket);

    const agent = await this.store.getAgentByGatewayId(gatewayId);
    if (!agent || agent.revokedAt) return rejectUpgrade(socket);

    const verification = verifyRelayUpgradeToken(token, getAgentSecret(agent));
    if (!verification.ok || verification.gatewayId !== gatewayId) {
      return rejectUpgrade(socket);
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      (request as IncomingMessage & { agent?: Agent }).agent = agent;
      this.wss.emit("connection", ws, request);
    });
  }

  async enroll(enrollmentToken: string, gatewayId: string): Promise<{
    secret: string;
    deliveryKey: string;
    tenant: string;
    gatewayId: string;
    agent: Agent;
  } | null> {
    const token = await this.store.redeemEnrollmentToken(sha256(enrollmentToken));
    if (!token) return null;
    let provisioned;
    try {
      provisioned = await provisionAgentForOwner(this.store, {
        ownerUserId: token.ownerUserId,
        gatewayId,
        displayName: `Hermes ${gatewayId.replace(/^gw-/, "")}`
      });
    } catch {
      return null;
    }
    const { agent, secret, deliveryKey } = provisioned;

    return {
      secret,
      deliveryKey,
      tenant: token.ownerUserId,
      gatewayId: agent.gatewayId,
      agent
    };
  }

  async deliverToAgent(agent: Agent, event: RelayInboundEvent, deliveryId?: string): Promise<boolean> {
    const connection = this.connections.get(agent.id);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) return false;
    sendFrame(connection.ws, {
      type: "inbound",
      event,
      ...(deliveryId ? { bufferId: deliveryId } : {})
    });
    return true;
  }

  disconnectAgent(agentId: string, code = 4403, reason = "revoked"): boolean {
    const connection = this.connections.get(agentId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) return false;
    connection.ws.close(code, reason);
    return true;
  }

  private async onConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const agent = (request as IncomingMessage & { agent?: Agent }).agent;
    if (!agent) {
      ws.close(4401, "unauthorized");
      return;
    }

    const existing = this.connections.get(agent.id);
    if (existing?.ws.readyState === WebSocket.OPEN) existing.ws.close(1000, "replaced");

    const connection: RelayConnection = { agent, ws, buffer: "", descriptorSent: false };
    this.connections.set(agent.id, connection);
    await this.store.setAgentConnected(agent.id, true);
    this.browserHub.sendToUser(agent.ownerUserId, {
      type: "agent_status",
      agentId: agent.id,
      gatewayId: agent.gatewayId,
      connected: true
    });

    ws.on("message", (chunk) => {
      void this.onSocketMessage(connection, chunk.toString("utf8"));
    });
    ws.on("close", () => {
      void this.onSocketClose(connection);
    });
  }

  private async onSocketClose(connection: RelayConnection): Promise<void> {
    if (this.connections.get(connection.agent.id)?.ws === connection.ws) {
      this.connections.delete(connection.agent.id);
    }
    await this.store.setAgentConnected(connection.agent.id, false);
    this.browserHub.sendToUser(connection.agent.ownerUserId, {
      type: "agent_status",
      agentId: connection.agent.id,
      gatewayId: connection.agent.gatewayId,
      connected: false
    });
  }

  private async onSocketMessage(connection: RelayConnection, chunk: string): Promise<void> {
    connection.buffer += chunk;
    const lines = connection.buffer.split("\n");
    connection.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        await this.handleFrame(connection, JSON.parse(trimmed));
      } catch (error) {
        sendFrame(connection.ws, {
          type: "error",
          error: error instanceof Error ? error.message : "invalid relay frame"
        });
      }
    }
  }

  private async handleFrame(connection: RelayConnection, frame: RelayFrame): Promise<void> {
    switch (frame.type) {
      case "hello":
        sendFrame(connection.ws, { type: "descriptor", descriptor });
        connection.descriptorSent = true;
        await this.drainPending(connection);
        break;
      case "outbound":
        await this.handleOutbound(connection, String(frame.requestId ?? ""), frame.action ?? {});
        break;
      case "inbound_ack":
        if (frame.bufferId) await this.store.markDeliveryAcked(String(frame.bufferId));
        break;
      case "going_idle":
        sendFrame(connection.ws, { type: "going_idle_ack" });
        break;
      case "interrupt":
        break;
      default:
        break;
    }
  }

  private async drainPending(connection: RelayConnection): Promise<void> {
    const deliveries = await this.store.listPendingDeliveries(connection.agent.id, 100);
    for (const delivery of deliveries) {
      const delivered = await this.deliverToAgent(connection.agent, delivery.event, delivery.id);
      if (delivered) await this.store.markDeliveryDelivered(delivery.id);
    }
  }

  private async handleOutbound(connection: RelayConnection, requestId: string, action: RelayFrame): Promise<void> {
    const op = action.op;
    if (op === "send") {
      if (!this.router) {
        sendFrame(connection.ws, { type: "outbound_result", requestId, result: { success: false, error: "router unavailable" } });
        return;
      }
      const result = await this.router.routeAgentMessage({
        channelId: String(action.chat_id ?? ""),
        agent: connection.agent,
        content: String(action.content ?? ""),
        replyToMessageId: action.reply_to ? String(action.reply_to) : null
      });
      sendFrame(connection.ws, {
        type: "outbound_result",
        requestId,
        result: {
          success: true,
          message_id: result.message.id,
          ...(result.throttled ? { warning: "agent loop guard paused peer forwarding" } : {})
        }
      });
      return;
    }

    if (op === "edit") {
      const message = await this.store.updateMessage(String(action.message_id ?? ""), String(action.content ?? ""));
      if (message) {
        await this.browserHub.broadcastChannel(message.channelId, {
          type: "message_updated",
          channelId: message.channelId,
          message
        });
      }
      sendFrame(connection.ws, {
        type: "outbound_result",
        requestId,
        result: message ? { success: true, message_id: message.id } : { success: false, error: "message not found" }
      });
      return;
    }

    if (op === "typing") {
      const channelId = String(action.chat_id ?? "");
      await this.browserHub.broadcastChannel(channelId, {
        type: "typing",
        channelId,
        agentId: connection.agent.id
      });
      sendFrame(connection.ws, { type: "outbound_result", requestId, result: { success: true } });
      return;
    }

    if (op === "get_chat_info") {
      const chatId = String(action.chat_id ?? "");
      const channel = await this.store.getChannel(chatId);
      sendFrame(connection.ws, {
        type: "outbound_result",
        requestId,
        result: { success: true, chat_info: { name: channel?.name ?? chatId, type: "group" } }
      });
      return;
    }

    sendFrame(connection.ws, {
      type: "outbound_result",
      requestId,
      result: { success: false, error: `unsupported op: ${String(op)}` }
    });
  }
}
