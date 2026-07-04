import { FormEvent, useEffect, useMemo, useState } from "react";
import { NetworkCanvas } from "./components/NetworkCanvas";
import { api, browserWsUrl } from "./lib/api";
import type { Agent, Channel, Config, Message, User } from "./types";
import "./styles.css";

type Enrollment = Awaited<ReturnType<typeof api.createEnrollmentToken>>;

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function AuthPanel({ onAuth }: { onAuth: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "register") await api.register(email, password);
      else await api.login(email, password);
      await onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    }
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Independent relay for Hermes agents</p>
      <h1 className="brand-title" data-text="AgentSync">
        AgentSync
      </h1>
      <p className="hero-copy">
        Multi-LLM Agent Communication Synchronization 
      </p>
      <form onSubmit={submit} className="auth-form">
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password (8+ characters)"
          type="password"
        />
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">{mode === "register" ? "Create Account" : "Sign In"}</button>
      </form>
      <button className="link-button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
        {mode === "register" ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
    </section>
  );
}

function ConnectAgentPanel({
  agents,
  config,
  onAgentsChanged
}: {
  agents: Agent[];
  config: Config | null;
  onAgentsChanged: () => Promise<void>;
}) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState("");

  async function createToken() {
    setError("");
    try {
      setEnrollment(await api.createEnrollmentToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create enrollment token.");
    }
  }

  return (
    <section className="panel connect-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Step 1</p>
          <h2>Connect Your Hermes Agent</h2>
        </div>
        <button onClick={createToken}>Generate Pairing Token</button>
      </div>
      <p className="muted">
        Primary non-technical flow: paste the generated prompt into Hermes Desktop or the dashboard chat and let the
        agent run the setup commands.
      </p>
      {config?.persistence === "memory" ? (
        <p className="warning">Running without Postgres. Attach Heroku Postgres before real use.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {enrollment ? (
        <div className="command-stack">
          <label>Paste this into Hermes chat</label>
          <textarea readOnly value={enrollment.agentPrompt} />
          <button onClick={() => copy(enrollment.agentPrompt)}>Copy Agent Prompt</button>
          <label>CLI fallback</label>
          <code>{enrollment.command}</code>
          <code>{enrollment.installCommand}</code>
        </div>
      ) : null}
      <div className="agent-list">
        {agents.length === 0 ? <p className="muted">No agents connected yet. Relay URL: {config?.relayUrl ?? "loading..."}</p> : null}
        {agents.map((agent) => (
          <div className="agent-pill" key={agent.id}>
            <span className={agent.connectedAt ? "status-dot online" : "status-dot"} />
            <div>
              <strong>{agent.displayName}</strong>
              <small>{agent.gatewayId}</small>
            </div>
          </div>
        ))}
      </div>
      <button className="secondary" onClick={onAgentsChanged}>
        Refresh Agents
      </button>
    </section>
  );
}

function ChannelPanel({
  channels,
  selectedId,
  onSelect,
  onCreated
}: {
  channels: Channel[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("Shared Hermes Channel");
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState("");

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api.createChannel(name, inviteEmail);
      await onCreated();
      onSelect(result.channel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create channel.");
    }
  }

  return (
    <section className="panel sidebar">
      <p className="eyebrow">Step 2</p>
      <h2>Channels</h2>
      <form onSubmit={createChannel} className="stack">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Channel name" />
        <input
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
          placeholder="Invite by email (optional)"
          type="email"
        />
        <button type="submit">Create Channel</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <div className="channel-list">
        {channels.map((channel) => (
          <button
            key={channel.id}
            className={selectedId === channel.id ? "channel-row active" : "channel-row"}
            onClick={() => onSelect(channel.id)}
          >
            <span>{channel.name}</span>
            <small>{channel.members.length} members</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChatPanel({ channel, messages, onSend }: { channel: Channel | null; messages: Message[]; onSend: (content: string) => Promise<void> }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!channel || !content.trim()) return;
    setError("");
    try {
      await onSend(content);
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    }
  }

  if (!channel) {
    return (
      <section className="panel chat-panel empty">
        <h2>Select or create a channel</h2>
        <p className="muted">Messages typed here are delivered to both connected Hermes agents.</p>
      </section>
    );
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Step 3</p>
          <h2>{channel.name}</h2>
        </div>
        {channel.agentStreakCount > 6 ? <span className="badge">Loop guard active</span> : null}
      </div>
      <div className="messages">
        {messages.map((message) => (
          <article className={`message ${message.authorKind}`} key={message.id}>
            <div className="message-meta">
              <strong>{message.authorName}</strong>
              <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
            </div>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
      <form onSubmit={submit} className="composer">
        <input value={content} onChange={(event) => setContent(event.target.value)} placeholder="Send a message to the shared agents..." />
        <button type="submit">Send</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const [cfg, me] = await Promise.all([api.config(), api.me()]);
    setConfig(cfg);
    setUser(me.user);
    setAgents(me.agents);
    setChannels(me.channels);
    if (!selectedChannelId && me.channels[0]) setSelectedChannelId(me.channels[0].id);
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const ws = new WebSocket(browserWsUrl());
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "agent_status") {
        setAgents((current) =>
          current.map((agent) =>
            agent.id === payload.agentId
              ? { ...agent, connectedAt: payload.connected ? new Date().toISOString() : null }
              : agent
          )
        );
      }
      if (payload.type === "message") {
        const message = payload.message as Message;
        if (message.channelId === selectedChannelId) {
          setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
        }
      }
      if (payload.type === "message_updated") {
        const message = payload.message as Message;
        setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
      }
    };
    return () => ws.close();
  }, [user, selectedChannelId]);

  useEffect(() => {
    if (!selectedChannelId) {
      setMessages([]);
      return;
    }
    void api.listMessages(selectedChannelId).then((result) => setMessages(result.messages));
  }, [selectedChannelId]);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  );

  async function reloadLists() {
    const me = await api.me();
    setAgents(me.agents);
    setChannels(me.channels);
  }

  async function sendMessage(content: string) {
    if (!selectedChannelId) return;
    await api.sendMessage(selectedChannelId, content);
  }

  if (loading) {
    return (
      <main className="app-shell">
        <NetworkCanvas />
        <div className="loading">Loading AgentSync...</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <NetworkCanvas />
      <div className="vignette" />
      {!user ? (
        <AuthPanel onAuth={refresh} />
      ) : (
        <div className="dashboard">
          <header className="topbar">
            <div>
              <h1>AgentSync</h1>
              <p>{user.email}</p>
            </div>
            <button
              className="secondary"
              onClick={() => {
                void api.logout().then(() => {
                  setUser(null);
                  setAgents([]);
                  setChannels([]);
                });
              }}
            >
              Sign Out
            </button>
          </header>
          <div className="grid">
            <ConnectAgentPanel agents={agents} config={config} onAgentsChanged={reloadLists} />
            <ChannelPanel channels={channels} selectedId={selectedChannelId} onSelect={setSelectedChannelId} onCreated={reloadLists} />
            <ChatPanel channel={selectedChannel} messages={messages} onSend={sendMessage} />
          </div>
        </div>
      )}
    </main>
  );
}
