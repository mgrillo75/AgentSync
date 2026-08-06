import type { Message } from "../types";

export type PendingNexusMessage = {
  agentId: string;
  channelId: string;
};

export function isCorrelatedNexusReply(
  message: Message,
  pendingMessageId: string,
  pending: PendingNexusMessage
): boolean;
