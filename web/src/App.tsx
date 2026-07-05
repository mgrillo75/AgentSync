import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, browserWsUrl } from "./lib/api";
import type { AccessKey, Agent, Channel, Config, Message, User } from "./types";
import waoBadgeUrl from "./wao-badge.svg";
import "./styles.css";

type Pairing = Awaited<ReturnType<typeof api.createAgentPairing>>;
type IssuedAccessKey = Awaited<ReturnType<typeof api.createAccessKey>>;
type AppView = "dashboard" | "agents" | "access" | "chat";

const navItems: Array<{ id: AppView; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "DB" },
  { id: "agents", label: "Agents", icon: "AG" },
  { id: "access", label: "Access", icon: "AK" },
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
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api.enterKey(accessKey.trim());
      await onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Access denied.");
    }
  }

  return (
    <section className="auth-card">
      <LogoLockup />
      <p className="eyebrow">Independent relay for connected agents</p>
      <h1>Command your agent network</h1>
      <p className="hero-copy">
        Paste a member access key to enter AgentSync.
      </p>
      <form onSubmit={submit} className="auth-form">
        <input
          value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)}
          placeholder="Access key"
          type="password"
          autoComplete="off"
        />
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Enter AgentSync</button>
      </form>
      <p className="muted">The first Founder key is printed once in the server logs.</p>
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
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState("");

  async function createPairing() {
    setError("");
    try {
      const result = await api.createAgentPairing();
      setPairing(result);
      await onAgentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent pairing.");
    }
  }

  return (
    <section className="panel connect-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Agents</p>
          <h2>Connect Your Agent</h2>
        </div>
        <button onClick={createPairing}>Generate Pairing</button>
      </div>
      <p className="muted">
        Paste the generated prompt into your agent workspace and let the
        agent write the relay environment lines. No Nous Portal login is required.
      </p>
      {config?.persistence === "memory" ? (
        <p className="warning">Running without Postgres. Attach Heroku Postgres before real use.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {pairing ? (
        <div className="command-stack">
          <label>Paste this into your agent chat</label>
          <textarea readOnly value={pairing.agentPrompt} />
          <button onClick={() => copy(pairing.agentPrompt)}>Copy Agent Prompt</button>
          <label>Manual .env lines</label>
          <code>{pairing.env}</code>
          <button className="secondary" onClick={() => copy(pairing.env)}>Copy Env Lines</button>
          <label>macOS/Linux helper</label>
          <code>{pairing.macCommands}</code>
          <label>Windows PowerShell helper</label>
          <code>{pairing.windowsCommands}</code>
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

function AccessPanel({
  accessKeys,
  onAccessChanged
}: {
  accessKeys: AccessKey[];
  onAccessChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<IssuedAccessKey | null>(null);
  const [error, setError] = useState("");

  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      const result = await api.createAccessKey(name.trim());
      setIssued(result);
      setName("");
      await onAccessChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create access key.");
    }
  }

  async function revokeKey(accessKeyId: string) {
    setError("");
    try {
      await api.revokeAccessKey(accessKeyId);
      await onAccessChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke access key.");
    }
  }

  return (
    <section className="panel connect-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Access</p>
          <h2>Member Keys</h2>
        </div>
      </div>
      <p className="muted">Create a named key for each trusted person. The full key is shown once.</p>
      <form onSubmit={createKey} className="stack">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Member name, e.g. Greg" />
        <button type="submit">Generate Access Key</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {issued ? (
        <div className="command-stack">
          <label>New key for {issued.user.name}</label>
          <code>{issued.token}</code>
          <button onClick={() => copy(issued.token)}>Copy Access Key</button>
        </div>
      ) : null}
      <div className="compact-list">
        {accessKeys.length === 0 ? <p className="muted">No member keys have been created yet.</p> : null}
        {accessKeys.map((accessKey) => (
          <article key={accessKey.id}>
            <div>
              <strong>{accessKey.userName}</strong>
              <small>
                {accessKey.tokenPreview}
                {accessKey.lastUsedAt ? ` - used ${new Date(accessKey.lastUsedAt).toLocaleString()}` : " - never used"}
              </small>
            </div>
            {accessKey.revokedAt ? (
              <span className="badge warning">Revoked</span>
            ) : (
              <button className="secondary" onClick={() => void revokeKey(accessKey.id)}>
                Revoke
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ChannelPanel({
  channels,
  members,
  selectedId,
  onSelect,
  onCreated
}: {
  channels: Channel[];
  members: User[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("Shared Agent Channel");
  const [inviteUserId, setInviteUserId] = useState("");
  const [error, setError] = useState("");

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api.createChannel(name, inviteUserId);
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
        <select value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)}>
          <option value="">No extra member</option>
          {members.map((member) => (
            <option value={member.id} key={member.id}>
              Invite {member.name}
            </option>
          ))}
        </select>
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
          <strong>{user.name}</strong>
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
  const [members, setMembers] = useState<User[]>([]);
  const [accessKeys, setAccessKeys] = useState<AccessKey[]>([]);
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
    if (me.user) {
      const [memberResult, accessKeyResult] = await Promise.all([api.listMembers(), api.listAccessKeys()]);
      setMembers(memberResult.members);
      setAccessKeys(accessKeyResult.accessKeys);
    } else {
      setMembers([]);
      setAccessKeys([]);
    }
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
    setUser(me.user);
    setAgents(me.agents);
    setChannels(me.channels);
    if (me.user) {
      const [memberResult, accessKeyResult] = await Promise.all([api.listMembers(), api.listAccessKeys()]);
      setMembers(memberResult.members);
      setAccessKeys(accessKeyResult.accessKeys);
    } else {
      setMembers([]);
      setAccessKeys([]);
    }
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
    setMembers([]);
    setAccessKeys([]);
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

            {activeView === "access" ? (
              <>
                <PageHeader title="Access" subtitle="Generate and revoke member access keys." live={wsConnected} />
                <AccessPanel accessKeys={accessKeys} onAccessChanged={reloadLists} />
              </>
            ) : null}

            {activeView === "chat" ? (
              <>
                <PageHeader title="Chat" subtitle="Create channels and send shared messages to connected agents." live={wsConnected} />
                <div className="chat-workspace">
                  <ChannelPanel
                    channels={channels}
                    members={members.filter((member) => member.id !== user.id)}
                    selectedId={selectedChannelId}
                    onSelect={setSelectedChannelId}
                    onCreated={reloadLists}
                  />
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
