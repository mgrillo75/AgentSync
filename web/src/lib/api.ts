import type { Agent, Channel, Config, Message, User } from "../types";

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
  register: (email: string, password: string) =>
    request<{ user: User }>("/api/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  createEnrollmentToken: () =>
    request<{
      token: string;
      relayUrl: string;
      command: string;
      installCommand: string;
      agentPrompt: string;
      enrollment: unknown;
    }>("/api/enrollment-tokens", { method: "POST", body: JSON.stringify({}) }),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  listChannels: () => request<{ channels: Channel[] }>("/api/channels"),
  createChannel: (name: string, inviteEmail: string) =>
    request<{ channel: Channel }>("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name, inviteEmail })
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
