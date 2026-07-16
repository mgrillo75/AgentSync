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
  connectedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
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

export type Config = {
  relayUrl: string;
  baseUrl: string;
  persistence: "postgres" | "memory";
};
