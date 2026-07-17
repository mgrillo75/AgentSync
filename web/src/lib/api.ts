import type { AccessKey, Agent, Channel, Config, Message, NexusGraph, ProviderKey, User } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

export const api = {
  config: () => request<Config>("/api/config"),
  me: () => request<{ user: User | null; agents: Agent[]; channels: Channel[] }>("/api/me"),
  enterKey: (token: string) =>
    request<{ user: User }>("/api/access", { method: "POST", body: JSON.stringify({ token }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  listMembers: () => request<{ members: User[] }>("/api/members"),
  listAccessKeys: () => request<{ accessKeys: AccessKey[] }>("/api/access-keys"),
  createAccessKey: (name: string) =>
    request<{ user: User; accessKey: AccessKey; token: string }>("/api/access-keys", {
      method: "POST",
      body: JSON.stringify({ name })
    }),
  revokeAccessKey: (accessKeyId: string) =>
    request<{ accessKey: AccessKey }>(`/api/access-keys/${accessKeyId}`, { method: "DELETE" }),
  listProviderKeys: () => request<{ providerKeys: ProviderKey[] }>("/api/provider-keys"),
  createProviderKey: (input: { provider: string; label?: string; key: string }) =>
    request<{ providerKey: ProviderKey }>("/api/provider-keys", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteProviderKey: (providerKeyId: string) =>
    request<{ ok: true }>(`/api/provider-keys/${providerKeyId}`, { method: "DELETE" }),
  createEnrollmentToken: () =>
    request<{
      token: string;
      relayUrl: string;
      command: string;
      installCommand: string;
      agentPrompt: string;
      enrollment: unknown;
    }>("/api/enrollment-tokens", { method: "POST", body: JSON.stringify({}) }),
  authorizeAgent: (input: {
    displayName: string;
    systemLabel: string;
    systemType: "laptop" | "desktop" | "server" | "other";
    agentKind?: string;
  }) =>
    request<{
      agent: Agent;
      relayUrl: string;
      gatewayId: string;
      secret: string;
      deliveryKey: string;
      env: string;
      shellExports: string;
      macPath: string;
      winPath: string;
      macCommands: string;
      windowsCommands: string;
      installCommand: string;
      restartCommand: string;
      agentPrompt: string;
    }>("/api/agents/authorize", { method: "POST", body: JSON.stringify(input) }),
  revokeAgent: (agentId: string) =>
    request<{ agent: Agent }>(`/api/agents/${agentId}/revoke`, { method: "POST", body: JSON.stringify({}) }),
  updateAgent: (agentId: string, patch: { displayName?: string; subtitleAlias?: string | null }) =>
    request<{ agent: Agent }>(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  setupScriptUrl: (agentId: string, os: "mac" | "windows") => `/api/agents/${agentId}/setup-script?os=${os}`,
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  nexusGraph: () => request<NexusGraph>("/api/nexus/graph"),
  sendToAgent: (agentId: string, content: string) =>
    request<{ message: Message; channelId: string }>(`/api/agents/${agentId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    }),
  listChannels: () => request<{ channels: Channel[] }>("/api/channels"),
  createChannel: (name: string, inviteUserId: string) =>
    request<{ channel: Channel }>("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name, inviteUserId })
    }),
  listMessages: (channelId: string) => request<{ messages: Message[] }>(`/api/channels/${channelId}/messages`),
  sendMessage: (channelId: string, content: string) =>
    request<{ message: Message }>(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    })
};

export function browserWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/browser`;
}
