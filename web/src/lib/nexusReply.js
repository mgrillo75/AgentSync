export function isCorrelatedNexusReply(message, pendingMessageId, pending) {
  return message.authorKind === "agent"
    && message.authorId === pending.agentId
    && message.channelId === pending.channelId
    && message.replyToMessageId === pendingMessageId;
}
