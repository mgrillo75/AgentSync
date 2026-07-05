import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, browserWsUrl } from "./lib/api";
import type { Agent, Channel, Config, Message, User } from "./types";
import waoBadgeUrl from "./wao-badge.svg";
import "./styles.css";

type Enrollment = Awaited<ReturnType<typeof api.createEnrollmentToken>>;
type AppView = "dashboard" | "agents" | "chat";

const navItems: Array<{ id: AppView; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "DB" },
  { id: "agents", label: "Agents", icon: "AG" },
  { id: "chat", label: "Chat", icon: "CH" }
];

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand-lockup compact" : "brand-lockup"}>
      <img className="brand-badge" src={waoBadgeUrl} alt="" aria-hidden="true" />
      <div>
        <small>WAO</small>
        <strong>AgentSync</strong>
      </div>
    </div>
  );
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
      <LogoLockup />
      <p className="eyebrow">Independent relay for connected agents</p>
      <h1>Command your agent network</h1>
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
          <p className="eyebrow">Agents</p>
          <h2>Connect Your Agent</h2>
        </div>
        <button onClick={createToken}>Generate Pairing Token</button>
      </div>
      <p className="muted">
        Paste the generated prompt into your agent workspace and let the
        agent run the setup commands.
      </p>
      {config?.persistence === "memory" ? (
        <p className="warning">Running without Postgres. Attach Heroku Postgres before real use.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {enrollment ? (
        <div className="command-stack">
          <label>Paste this into your agent chat</label>
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
            <span className="agent-avatar">{initials(agent.displayName)}</span>
            <div>
              <strong>{agent.displayName}</strong>
              <small>{agent.gatewayId}</small>
            </div>
            <span className={agent.connectedAt ? "status-dot online" : "status-dot"} />
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
  const [name, setName] = useState("Shared Agent Channel");
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
      <p className="eyebrow">Channels</p>
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
        {channels.length === 0 ? <p className="muted">Create a channel to start messaging connected agents.</p> : null}
        {channels.map((channel) => (
          <button
            key={channel.id}
            className={selectedId === channel.id ? "channel-row active" : "channel-row"}
            onClick={() => onSelect(channel.id)}
          >
            <span>
              <strong>{channel.name}</strong>
              <small>{channel.members.length} members</small>
            </span>
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
        <p className="muted">Messages typed here are delivered to connected agents.</p>
      </section>
    );
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Shared Chat</p>
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

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AG";
}

function StatCard({
  label,
  value,
  accent,
  icon,
  sublabel
}: {
  label: string;
  value: string | number;
  accent: "teal" | "blue" | "amber" | "purple" | "green";
  icon: string;
  sublabel?: string;
}) {
  return (
    <article className={`stat-card ${accent}`}>
      <span className="stat-icon">{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      {sublabel ? <span>{sublabel}</span> : null}
    </article>
  );
}

function PageHeader({ title, subtitle, live }: { title: string; subtitle: string; live: boolean }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <span className={live ? "live-pill online" : "live-pill"}>
        <span className={live ? "status-dot online" : "status-dot"} />
        {live ? "Live" : "Offline"}
      </span>
    </header>
  );
}

function AppSidebar({
  activeView,
  onChange,
  user,
  wsConnected,
  onLogout
}: {
  activeView: AppView;
  onChange: (view: AppView) => void;
  user: User;
  wsConnected: boolean;
  onLogout: () => void;
}) {
  return (
    <aside className="app-sidebar">
      <LogoLockup compact />
      <nav className="nav-list" aria-label="Primary">
        {navItems.map((item) => (
          <button key={item.id} className={activeView === item.id ? "nav-item active" : "nav-item"} onClick={() => onChange(item.id)}>
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="user-card">
          <small>Signed in</small>
          <strong>{user.email}</strong>
        </div>
        <button className="secondary full-width" onClick={onLogout}>
          Sign Out
        </button>
        <p className="network-status">
          <span className={wsConnected ? "status-dot online" : "status-dot"} />
          {wsConnected ? "Network Active" : "Network Offline"}
        </p>
      </div>
    </aside>
  );
}

function DashboardView({
  agents,
  channels,
  messages,
  wsConnected
}: {
  agents: Agent[];
  channels: Channel[];
  messages: Message[];
  wsConnected: boolean;
}) {
  const activeAgents = agents.filter((agent) => agent.connectedAt).length;
  const memberCount = channels.reduce((total, channel) => total + channel.members.length, 0);
  const latestAgents = agents.slice(0, 6);
  const latestChannels = channels.slice(0, 5);

  return (
    <div className="view-stack">
      <section className="stat-grid">
        <StatCard label="Active Agents" value={activeAgents} sublabel={`/ ${agents.length}`} accent="green" icon="AG" />
        <StatCard label="Channels" value={channels.length} accent="blue" icon="CH" />
        <StatCard label="Messages Loaded" value={messages.length} accent="amber" icon="MS" />
        <StatCard label="Members" value={memberCount} accent="purple" icon="MB" />
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Agent Hive</p>
              <h2>Connected Agents</h2>
            </div>
            <span className={wsConnected ? "badge success" : "badge"}>{wsConnected ? "Live" : "Idle"}</span>
          </div>
          <div className="agent-tile-grid">
            {latestAgents.length === 0 ? <p className="muted">No agents connected yet.</p> : null}
            {latestAgents.map((agent) => (
              <article className={agent.connectedAt ? "agent-tile online" : "agent-tile"} key={agent.id}>
                <span className="agent-avatar">{initials(agent.displayName)}</span>
                <strong>{agent.displayName}</strong>
                <small>{agent.connectedAt ? "Online" : "Offline"}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Workspaces</p>
              <h2>Channels</h2>
            </div>
          </div>
          <div className="compact-list">
            {latestChannels.length === 0 ? <p className="muted">Create your first channel from Chat.</p> : null}
            {latestChannels.map((channel) => (
              <article key={channel.id}>
                <div>
                  <strong>{channel.name}</strong>
                  <small>{channel.members.length} members</small>
                </div>
                {channel.agentStreakCount > 6 ? <span className="badge warning">Guard</span> : null}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
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
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [wsConnected, setWsConnected] = useState(false);

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
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
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
    return () => {
      setWsConnected(false);
      ws.close();
    };
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

  async function logout() {
    await api.logout();
    setUser(null);
    setAgents([]);
    setChannels([]);
    setMessages([]);
    setSelectedChannelId(null);
    setActiveView("dashboard");
    setWsConnected(false);
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading">Loading AgentSync...</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {!user ? (
        <AuthPanel onAuth={refresh} />
      ) : (
        <div className="dashboard-shell">
          <AppSidebar activeView={activeView} onChange={setActiveView} user={user} wsConnected={wsConnected} onLogout={() => void logout()} />
          <div className="main-workspace">
            {activeView === "dashboard" ? (
              <>
                <PageHeader title="Command Center" subtitle="Real-time overview of the AgentSync relay." live={wsConnected} />
                <DashboardView agents={agents} channels={channels} messages={messages} wsConnected={wsConnected} />
              </>
            ) : null}

            {activeView === "agents" ? (
              <>
                <PageHeader title="Agents" subtitle="Generate pairing tokens and monitor connected agents." live={wsConnected} />
                <ConnectAgentPanel agents={agents} config={config} onAgentsChanged={reloadLists} />
              </>
            ) : null}

            {activeView === "chat" ? (
              <>
                <PageHeader title="Chat" subtitle="Create channels and send shared messages to connected agents." live={wsConnected} />
                <div className="chat-workspace">
                  <ChannelPanel channels={channels} selectedId={selectedChannelId} onSelect={setSelectedChannelId} onCreated={reloadLists} />
                  <ChatPanel channel={selectedChannel} messages={messages} onSend={sendMessage} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
