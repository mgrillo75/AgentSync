import type { BrowserHub } from "./browserHub.js";
import type { Store } from "../db/store.js";
import type { Agent, Message, RelayInboundEvent } from "../types.js";

export interface AgentDelivery {
  deliverToAgent(agent: Agent, event: RelayInboundEvent, deliveryId?: string): Promise<boolean>;
}

const AGENT_LOOP_LIMIT = 6;

export class MessageRouter {
  constructor(
    private store: Store,
    private browserHub: BrowserHub,
    private agentDelivery: AgentDelivery
  ) {}

  buildInboundEvent(message: Message, channelName: string): RelayInboundEvent {
    return {
      text: message.content,
      message_type: "text",
      message_id: message.id,
      reply_to_message_id: message.replyToMessageId,
      media_urls: [],
      media_types: [],
      source: {
        platform: "relay",
        chat_id: message.channelId,
        chat_type: "group",
        chat_name: channelName,
        user_id: `${message.authorKind}:${message.authorId}`,
        user_name: message.authorName,
        thread_id: message.threadId,
        chat_topic: "AgentSync shared channel",
        message_id: message.id
      }
    };
  }

  async routeHumanMessage(input: {
    channelId: string;
    userId: string;
    userName: string;
    content: string;
    replyToMessageId?: string | null;
  }): Promise<Message> {
    const channel = await this.store.getChannel(input.channelId);
    if (!channel) throw new Error("channel not found");

    await this.store.resetChannelAgentStreak(input.channelId);
    const message = await this.store.createMessage({
      channelId: input.channelId,
      authorKind: "user",
      authorId: input.userId,
      authorName: input.userName,
      content: input.content,
      replyToMessageId: input.replyToMessageId ?? null
    });

    await this.browserHub.broadcastChannel(input.channelId, {
      type: "message",
      channelId: input.channelId,
      message
    });
    await this.deliverMessageToAgents(message, channel.name);
    return message;
  }

  async routeAgentMessage(input: {
    channelId: string;
    agent: Agent;
    content: string;
    replyToMessageId?: string | null;
  }): Promise<{ message: Message; forwarded: boolean; throttled: boolean }> {
    const channelBefore = await this.store.getChannel(input.channelId);
    if (!channelBefore) throw new Error("channel not found");

    const channel = await this.store.incrementChannelAgentStreak(input.channelId);
    const throttled = channel.agentStreakCount > AGENT_LOOP_LIMIT;
    const message = await this.store.createMessage({
      channelId: input.channelId,
      authorKind: "agent",
      authorId: input.agent.id,
      authorName: input.agent.displayName,
      content: input.content,
      replyToMessageId: input.replyToMessageId ?? null
    });

    await this.browserHub.broadcastChannel(input.channelId, {
      type: "message",
      channelId: input.channelId,
      message
    });

    if (throttled) {
      await this.browserHub.broadcastChannel(input.channelId, {
        type: "system",
        message: `Agent-to-agent loop guard paused ${channel.name}. A human message resumes delivery.`
      });
      return { message, forwarded: false, throttled: true };
    }

    await this.deliverMessageToAgents(message, channel.name, input.agent.id);
    return { message, forwarded: true, throttled: false };
  }

  async deliverMessageToAgents(message: Message, channelName: string, excludeAgentId?: string): Promise<void> {
    const agents = await this.store.listAgentsForChannel(message.channelId);
    const event = this.buildInboundEvent(message, channelName);

    for (const agent of agents) {
      if (agent.revokedAt) continue;
      if (agent.id === excludeAgentId) continue;
      const delivery = await this.store.createDelivery({
        agentId: agent.id,
        channelId: message.channelId,
        messageId: message.id,
        event
      });
      const delivered = await this.agentDelivery.deliverToAgent(agent, event, delivery.id);
      if (delivered) await this.store.markDeliveryDelivered(delivery.id);
    }
  }
}
