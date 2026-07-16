import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, browserWsUrl } from "./lib/api";
import { PROVIDERS, providerLabel } from "./lib/providers";
import { RelaysView } from "./components/relays/RelaysView";
import type { AccessKey, Agent, AgentSystemType, Channel, Config, Message, ProviderKey, User } from "./types";
import waoBadgeUrl from "./wao-badge.svg";
import "./styles.css";

type Authorization = Awaited<ReturnType<typeof api.authorizeAgent>>;
type IssuedAccessKey = Awaited<ReturnType<typeof api.createAccessKey>>;
type AppView = "dashboard" | "agents" | "relays" | "providers" | "access" | "chat";

const navItems: Array<{ id: AppView; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "DB" },
  { id: "agents", label: "Agents", icon: "AG" },
  { id: "access", label: "Access", icon: "AK" },
  { id: "chat", label: "Chat", icon: "CH" },
  { id: "relays", label: "Relays", icon: "RL" },
  { id: "providers", label: "Providers", icon: "PR" }
];

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function SetupScriptLinks({ agentId, compact = false }: { agentId: string; compact?: boolean }) {
  return (
    <div className={compact ? "setup-downloads compact" : "setup-downloads"}>
      <a className="link-button" href={api.setupScriptUrl(agentId, "mac")}>
        Download Mac setup file
      </a>
      <a className="link-button" href={api.setupScriptUrl(agentId, "windows")}>
        Download Windows setup file
      </a>
    </div>
  );
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
  const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [systemLabel, setSystemLabel] = useState("");
  const [systemType, setSystemType] = useState<AgentSystemType>("laptop");
  const [agentKind, setAgentKind] = useState("");
  const [error, setError] = useState("");

  async function authorizeAgent(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api.authorizeAgent({
        displayName: displayName.trim(),
        systemLabel: systemLabel.trim(),
        systemType,
        ...(agentKind.trim() ? { agentKind: agentKind.trim() } : {})
      });
      setAuthorization(result);
      setShowForm(false);
      setDisplayName("");
      setSystemLabel("");
      setAgentKind("");
      await onAgentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not authorize agent.");
    }
  }

  async function revokeAgent(agent: Agent) {
    if (!window.confirm(`Revoke ${agent.displayName}? It will be disconnected and cannot reconnect.`)) return;
    setError("");
    try {
      await api.revokeAgent(agent.id);
      await onAgentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke agent.");
    }
  }

  return (
    <section className="panel connect-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Agents</p>
          <h2>Authorized Agents</h2>
        </div>
        <button onClick={() => setShowForm((current) => !current)}>Authorize Agent</button>
      </div>
      <p className="muted">
        You authorize an agent once. It can reconnect any time — whether or not you are online — until you revoke it.
        Credentials are shown a single time below.
      </p>
      {showForm ? (
        <form onSubmit={authorizeAgent} className="stack">
          <label>
            Agent name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
          </label>
          <label>
            System label
            <input
              value={systemLabel}
              onChange={(event) => setSystemLabel(event.target.value)}
              placeholder="e.g. Office desktop"
              maxLength={120}
              required
            />
          </label>
          <label>
            System type
            <select value={systemType} onChange={(event) => setSystemType(event.target.value as AgentSystemType)}>
              <option value="laptop">Laptop</option>
              <option value="desktop">Desktop</option>
              <option value="server">Server</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Agent kind (optional)
            <input
              value={agentKind}
              onChange={(event) => setAgentKind(event.target.value)}
              placeholder="e.g. hermes, claude-code, openclaw"
              maxLength={80}
            />
          </label>
          <button type="submit">Authorize and Generate Credentials</button>
        </form>
      ) : null}
      {config?.persistence === "memory" ? (
        <p className="warning">Running without Postgres. Attach Heroku Postgres before real use.</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {authorization ? (
        <div className="command-stack">
          <label>Paste this into your agent chat</label>
          <textarea readOnly value={authorization.agentPrompt} />
          <button onClick={() => copy(authorization.agentPrompt)}>Copy Agent Prompt</button>
          <label>If Hermes chat is not responding</label>
          <SetupScriptLinks agentId={authorization.agent.id} />
          <p className="setup-note">
            On macOS, double-click the downloaded file. If macOS blocks it, right-click the file and choose Open, then Open
            again.
          </p>
          <label>Manual .env lines</label>
          <code>{authorization.env}</code>
          <button className="secondary" onClick={() => copy(authorization.env)}>Copy Env Lines</button>
          <label>macOS/Linux helper</label>
          <code>{authorization.macCommands}</code>
          <label>Windows PowerShell helper</label>
          <code>{authorization.windowsCommands}</code>
        </div>
      ) : null}
      <div className="compact-list">
        {agents.length === 0 ? <p className="muted">No agents authorized yet. Relay URL: {config?.relayUrl ?? "loading..."}</p> : null}
        {agents.map((agent) => (
          <article className={agent.revokedAt ? "revoked" : undefined} key={agent.id}>
            <span className="agent-avatar">{initials(agent.displayName)}</span>
            <div>
              <strong>{agent.displayName}</strong>
              <small>
                {agent.systemLabel ?? "Unknown system"} · {agent.systemType ?? "other"} · authorized {new Date(agent.createdAt).toLocaleString()}
              </small>
              <small>{agent.lastSeenAt ? `Last seen ${new Date(agent.lastSeenAt).toLocaleString()}` : "Never connected"}</small>
            </div>
            {agent.systemType ? <span className="badge">{agent.systemType}</span> : null}
            <span className={agent.connectedAt ? "status-dot online" : "status-dot"} />
            {agent.revokedAt ? (
              <span className="badge warning">Revoked</span>
            ) : (
              <>
                <SetupScriptLinks agentId={agent.id} compact />
                <button className="secondary" onClick={() => void revokeAgent(agent)}>Revoke</button>
              </>
            )}
          </article>
        ))}
      </div>
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

function ProvidersPanel() {
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [provider, setProvider] = useState<string>(PROVIDERS[0]?.id ?? "openai");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function reloadProviderKeys() {
    const result = await api.listProviderKeys();
    setProviderKeys(result.providerKeys);
  }

  useEffect(() => {
    void reloadProviderKeys()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load provider keys."))
      .finally(() => setLoading(false));
  }, []);

  async function createKey(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    setError("");
    try {
      await api.createProviderKey({
        provider,
        label: label.trim() || undefined,
        key: key.trim()
      });
      setLabel("");
      setKey("");
      await reloadProviderKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not store provider key.");
    }
  }

  async function deleteKey(providerKeyId: string) {
    setError("");
    try {
      await api.deleteProviderKey(providerKeyId);
      await reloadProviderKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete provider key.");
    }
  }

  return (
    <section className="panel connect-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Providers</p>
          <h2>LLM API Keys</h2>
        </div>
      </div>
      <p className="muted">
        Keys are encrypted at rest and never shown again. Resubmitting a provider replaces its key.
      </p>
      <form onSubmit={createKey} className="stack">
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
          {PROVIDERS.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label, optional" />
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={`${providerLabel(provider)} API key`}
          type="password"
          autoComplete="off"
        />
        <button type="submit">Store Provider Key</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      <div className="compact-list">
        {!loading && providerKeys.length === 0 ? <p className="muted">No provider keys stored yet.</p> : null}
        {loading ? <p className="muted">Loading provider keys...</p> : null}
        {providerKeys.map((providerKey) => (
          <article key={providerKey.id}>
            <div>
              <strong>{providerKey.label || providerLabel(providerKey.provider)}</strong>
              <small>
                {providerLabel(providerKey.provider)} - {providerKey.keyPreview} -{" "}
                {new Date(providerKey.createdAt).toLocaleString()}
              </small>
            </div>
            <button className="secondary" onClick={() => void deleteKey(providerKey.id)}>
              Delete
            </button>
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
  const authorizedAgents = agents.filter((agent) => !agent.revokedAt);
  const activeAgents = authorizedAgents.filter((agent) => agent.connectedAt).length;
  const memberCount = channels.reduce((total, channel) => total + channel.members.length, 0);
  const latestAgents = authorizedAgents.slice(0, 6);
  const latestChannels = channels.slice(0, 5);

  return (
    <div className="view-stack">
      <section className="stat-grid">
        <StatCard label="Active Agents" value={activeAgents} sublabel={`/ ${authorizedAgents.length}`} accent="green" icon="AG" />
        <StatCard label="Channels" value={channels.length} accent="blue" icon="CH" />
        <StatCard label="Messages Loaded" value={messages.length} accent="amber" icon="MS" />
        <StatCard label="Members" value={memberCount} accent="purple" icon="MB" />
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Consortium</p>
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
                <small>{agent.systemLabel ?? (agent.connectedAt ? "Online" : "Offline")}</small>
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
      if (payload.type === "agent_revoked") {
        setAgents((current) =>
          current.map((agent) =>
            agent.id === payload.agentId
              ? { ...agent, revokedAt: new Date().toISOString(), connectedAt: null }
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
                <PageHeader title="Agents" subtitle="Authorize agents to connect from your devices, and revoke access at any time." live={wsConnected} />
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

            {activeView === "relays" ? <RelaysView agents={agents} /> : null}

            {activeView === "providers" ? (
              <>
                <PageHeader title="Providers" subtitle="Store encrypted LLM provider API keys for future agent execution." live={wsConnected} />
                <ProvidersPanel />
              </>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
