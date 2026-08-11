export type PlatformRole = "platform_admin" | "member";

export type MemoryServiceState = "healthy" | "degraded" | "offline" | "unconfigured";
export type MemoryDependencyState = "ok" | "unavailable" | "unknown";
export type MemoryServiceStatus = {
  configured: boolean;
  status: MemoryServiceState;
  database: MemoryDependencyState;
  vectorStore: MemoryDependencyState;
  authenticationConfigured: boolean;
  serviceUrl: string | null;
  checkedAt: string;
};

export type User = {
  id: string;
  name: string;
  platformRole: PlatformRole;
  createdAt: string;
};

export type WaoInstanceStatus = "active";

export type WaoInstance = {
  id: string;
  name: string;
  status: WaoInstanceStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
  agents?: Agent[];
};

export type AgentSystemType = "laptop" | "desktop" | "server" | "other";

export type Agent = {
  id: string;
  ownerUserId: string;
  gatewayId: string;
  displayName: string;
  subtitleAlias: string | null;
  systemLabel: string | null;
  systemType: AgentSystemType | null;
  agentKind: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type NexusLink = {
  fromKind: "user" | "agent";
  fromId: string;
  toKind: "user" | "agent";
  toId: string;
  lastAt: string;
  count: number;
};

export type NexusGraph = {
  member: User;
  agents: Agent[];
  links: NexusLink[];
};

export type ProviderKey = {
  id: string;
  ownerUserId: string;
  provider: string;
  label: string;
  keyPreview: string;
  createdAt: string;
};

export type ChannelMember = {
  channelId: string;
  memberKind: "user" | "agent";
  memberId: string;
  createdAt: string;
};

export type Channel = {
  id: string;
  name: string;
  createdBy: string;
  kind: "chat" | "dm";
  dmAgentId: string | null;
  agentStreakCount: number;
  throttledUntil: string | null;
  createdAt: string;
  members: ChannelMember[];
};

export type Message = {
  id: string;
  channelId: string;
  threadId: string | null;
  authorKind: "user" | "agent" | "system";
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
  deliveredAt: string | null;
  ackedAt: string | null;
  createdAt: string;
};

export type DeliveryAttempt = {
  delivery: Delivery;
  status: "queued" | "sent";
};

export type DirectSendResult = {
  message: Message;
  channel: Channel;
  delivery: DeliveryAttempt | null;
};

export type DeliveryStatus = "queued" | "sent" | "received";

export type DeliveryStatusEvent = {
  type: "delivery_status";
  status: DeliveryStatus;
  delivery: Delivery;
  deliveryId: string;
  messageId: string;
  agentId: string;
  channelId: string;
};

export type BrowserEvent =
  | { type: "agent_status"; agentId: string; gatewayId: string; connected: boolean }
  | { type: "agent_revoked"; agentId: string; gatewayId: string }
  | { type: "message"; channelId: string; message: Message }
  | { type: "message_updated"; channelId: string; message: Message }
  | DeliveryStatusEvent
  | { type: "typing"; channelId: string; agentId: string }
  | { type: "channel"; channel: Channel }
  | { type: "system"; message: string };

export type NexusSendState = {
  agentId: string;
  agentName: string;
  messageId: string | null;
  channelId: string | null;
  deliveryId: string | null;
  status: "sending" | DeliveryStatus;
};

export type Config = {
  relayUrl: string;
  baseUrl: string;
  persistence: "postgres" | "memory";
};
