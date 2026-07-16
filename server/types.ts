export type User = {
  id: string;
  name: string;
  createdAt: string;
};

export type AccessKey = {
  id: string;
  userId: string;
  userName: string;
  tokenPreview: string;
  label: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type AgentSystemType = "laptop" | "desktop" | "server" | "other";

export type Agent = {
  id: string;
  ownerUserId: string;
  gatewayId: string;
  displayName: string;
  systemLabel: string | null;
  systemType: AgentSystemType | null;
  agentKind: string | null;
  secret: string;
  deliveryKey: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type LlmAgentRole = "coordinator" | "worker";

export type LlmAgent = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  role: LlmAgentRole;
  tools: string[];
  avatarSeed: string;
  parentId: string | null;
  x: number | null;
  y: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderKey = {
  id: string;
  ownerUserId: string;
  provider: string;
  label: string;
  encryptedKey: string;
  keyPreview: string;
  createdAt: string;
};

export type EnrollmentToken = {
  id: string;
  ownerUserId: string;
  tokenHash: string;
  tokenPreview: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type Channel = {
  id: string;
  name: string;
  createdBy: string;
  agentStreakCount: number;
  throttledUntil: string | null;
  createdAt: string;
};

export type ChannelMemberKind = "user" | "agent";

export type ChannelMember = {
  channelId: string;
  memberKind: ChannelMemberKind;
  memberId: string;
  createdAt: string;
};

export type MessageAuthorKind = "user" | "agent" | "system";

export type Message = {
  id: string;
  channelId: string;
  threadId: string | null;
  authorKind: MessageAuthorKind;
  authorId: string;
  authorName: string;
  content: string;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
};

export type Delivery = {
  id: string;
  agentId: string;
  channelId: string;
  messageId: string;
  event: RelayInboundEvent;
  deliveredAt: string | null;
  ackedAt: string | null;
  createdAt: string;
};

export type RelaySessionSource = {
  platform: string;
  chat_id: string;
  chat_type: string;
  chat_name: string | null;
  user_id: string | null;
  user_name: string | null;
  thread_id: string | null;
  chat_topic: string | null;
  message_id?: string;
};

export type RelayInboundEvent = {
  text: string;
  message_type: "text";
  source: RelaySessionSource;
  message_id: string;
  reply_to_message_id?: string | null;
  media_urls?: string[];
  media_types?: string[];
};

export type ChannelView = Channel & {
  members: ChannelMember[];
};
