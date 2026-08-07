import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, browserWsUrl } from "./lib/api";
import { isCorrelatedNexusReply, type PendingNexusMessage } from "./lib/nexusReply.js";
import { PROVIDERS, providerLabel } from "./lib/providers";
import { RelaysView } from "./components/relays/RelaysView";
import { NexusView } from "./components/nexus/NexusView";
import type { AccessKey, Agent, AgentSystemType, BrowserEvent, Config, DeliveryStatus, Message, NexusSendState, ProviderKey, User, WaoInstance } from "./types";
import waoBadgeUrl from "./wao-badge.svg";
import "./styles.css";

type Authorization = Awaited<ReturnType<typeof api.authorizeAgent>>;
type IssuedAccessKey = Awaited<ReturnType<typeof api.createAccessKey>>;
type AppView = "dashboard" | "wao-instances" | "agents" | "relays" | "providers" | "comms" | "access";

const navItems: Array<{ id: AppView; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "dashboard", label: "Dashboard", icon: "DB" },
  { id: "wao-instances", label: "WAO Instances", icon: "WI", adminOnly: true },
  { id: "agents", label: "Agents", icon: "AG" },
  { id: "access", label: "Access", icon: "AK" },
  { id: "relays", label: "Relays", icon: "RL" },
  { id: "providers", label: "Providers", icon: "PR" },
  { id: "comms", label: "Comms", icon: "CM" }
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
  const visibleAgents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return agents.filter((agent) => Boolean(agent.connectedAt) || Boolean(agent.lastSeenAt && Date.parse(agent.lastSeenAt) >= cutoff));
  }, [agents]);

  useEffect(() => {
    void api.listAgents().catch(() => undefined);
  }, []);

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
        {visibleAgents.length === 0 ? <p className="muted">No online or recently seen agents. Relay URL: {config?.relayUrl ?? "loading..."}</p> : null}
        {visibleAgents.map((agent) => (
          <article className={agent.revokedAt ? "revoked" : undefined} key={agent.id}>
            <span className="agent-avatar">{initials(agent.displayName)}</span>
            <div>
              <AgentLabelEditor agent={agent} onChanged={onAgentsChanged} />
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

function AgentLabelEditor({ agent, onChanged }: { agent: Agent; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [subtitleAlias, setSubtitleAlias] = useState(agent.subtitleAlias ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDisplayName(agent.displayName);
    setSubtitleAlias(agent.subtitleAlias ?? "");
  }, [agent.displayName, agent.subtitleAlias, editing]);

  if (!editing) {
    return (
      <div className="agent-label-summary">
        <strong>{agent.displayName}</strong>
        <small>{agent.subtitleAlias ?? agent.gatewayId}</small>
        <button type="button" className="label-edit-button" onClick={() => setEditing(true)}>Edit labels</button>
      </div>
    );
  }

  return (
    <form
      className="agent-label-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!displayName.trim()) return;
        setSaving(true);
        void api.updateAgent(agent.id, { displayName: displayName.trim(), subtitleAlias: subtitleAlias.trim() || null })
          .then(onChanged)
          .then(() => setEditing(false))
          .finally(() => setSaving(false));
      }}
    >
      <input aria-label="Agent display name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required />
      <input aria-label="Relays subtitle" value={subtitleAlias} maxLength={120} placeholder={agent.gatewayId} onChange={(event) => setSubtitleAlias(event.target.value)} />
      <div className="agent-label-actions">
        <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
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
          <article className="access-member-card" key={accessKey.id}>
            <div className="access-member-row">
              <span className="access-member-avatar">{initials(accessKey.userName)}</span>
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
            </div>
            <div className="ownership-diagram">
              <span className="ownership-line" aria-hidden="true" />
              <div className="ownership-agents">
                {(accessKey.agents ?? []).length === 0 ? <small className="muted">No agents authorized by this member.</small> : null}
                {(accessKey.agents ?? []).map((agent) => (
                  <div className="ownership-agent" key={agent.id}>
                    <span className="agent-avatar">{initials(agent.displayName)}</span>
                    <span><strong>{agent.displayName}</strong><small>{agent.subtitleAlias ?? agent.gatewayId}</small></span>
                    <span className={agent.connectedAt ? "status-dot online" : "status-dot"} title={agent.connectedAt ? "Online" : "Offline"} />
                  </div>
                ))}
              </div>
            </div>
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
        {navItems.filter((item) => !item.adminOnly || user.platformRole === "platform_admin").map((item) => (
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

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function WaoInstanceCard({ instance, onOpen }: { instance: WaoInstance; onOpen: (instanceId: string) => void }) {
  return (
    <button className="wao-instance-card" type="button" onClick={() => onOpen(instance.id)}>
      <span>
        <strong>{instance.name}</strong>
        <small>Created {formatShortDate(instance.createdAt)}</small>
      </span>
      <span className="badge success">Active</span>
    </button>
  );
}

function WaoInstancesView({
  instances,
  members,
  selectedId,
  onSelect,
  onCreated
}: {
  instances: WaoInstance[];
  members: User[];
  selectedId: string | null;
  onSelect: (instanceId: string | null) => void;
  onCreated: (instance: WaoInstance) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = instances.find((instance) => instance.id === selectedId) ?? null;

  async function createInstance(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setError("");
    setSaving(true);
    try {
      const result = await api.createWaoInstance(trimmedName);
      onCreated(result.instance);
      setName("");
      setShowCreate(false);
      onSelect(result.instance.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the WAO instance.");
    } finally {
      setSaving(false);
    }
  }

  if (selected) {
    const creatorName = members.find((member) => member.id === selected.createdBy)?.name ?? "Platform administrator";
    return (
      <div className="view-stack">
        <button className="secondary back-button" type="button" onClick={() => onSelect(null)}>Back to WAO Instances</button>
        <section className="panel wao-instance-detail">
          <div className="panel-header">
            <div>
              <p className="eyebrow">WAO Instance</p>
              <h2>{selected.name}</h2>
            </div>
            <span className="badge success">Active</span>
          </div>
          <dl className="instance-meta">
            <div><dt>Created by</dt><dd>{creatorName}</dd></div>
            <div><dt>Created</dt><dd>{formatShortDate(selected.createdAt)}</dd></div>
            <div><dt>Status</dt><dd>Active</dd></div>
          </dl>
          <div className="instance-next-step">
            <strong>Instance shell ready</strong>
            <p>Agents, channels, Work, and other operational modules will be attached to this instance in later iterations.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="view-stack">
      <section className="panel wao-instance-manager">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Platform Administration</p>
            <h2>Active WAO Instances</h2>
          </div>
          <button type="button" onClick={() => setShowCreate((current) => !current)}>{showCreate ? "Cancel" : "Create Instance"}</button>
        </div>
        {showCreate ? (
          <form className="wao-instance-form" onSubmit={createInstance}>
            <label>
              Client / WAO name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus placeholder="Example Client WAO" />
            </label>
            <button type="submit" disabled={!name.trim() || saving}>{saving ? "Creating..." : "Create"}</button>
          </form>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        {instances.length === 0 ? <p className="muted">No WAO instances have been created yet.</p> : null}
        <div className="wao-instance-grid">
          {instances.map((instance) => <WaoInstanceCard key={instance.id} instance={instance} onOpen={onSelect} />)}
        </div>
      </section>
    </div>
  );
}

function DashboardView({
  agents,
  wsConnected,
  user,
  waoInstances,
  onOpenWaoInstance,
  onViewAllWaoInstances
}: {
  agents: Agent[];
  wsConnected: boolean;
  user: User;
  waoInstances: WaoInstance[];
  onOpenWaoInstance: (instanceId: string) => void;
  onViewAllWaoInstances: () => void;
}) {
  const authorizedAgents = agents.filter((agent) => !agent.revokedAt);
  const activeAgents = authorizedAgents.filter((agent) => agent.connectedAt).length;
  const latestAgents = authorizedAgents.slice(0, 6);

  return (
    <div className="view-stack">
      <section className="stat-grid simplified">
        <StatCard label="Active Agents" value={activeAgents} sublabel={`/ ${authorizedAgents.length}`} accent="green" icon="AG" />
      </section>

      <section className={`${user.platformRole === "platform_admin" ? "dashboard-grid admin" : "dashboard-grid"} simplified`}>
        <div className="panel consortium-panel">
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

        {user.platformRole === "platform_admin" ? (
          <div className="panel wao-dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Platform</p>
                <h2>WAO Instances</h2>
              </div>
              <button className="label-edit-button" type="button" onClick={onViewAllWaoInstances}>View all</button>
            </div>
            {waoInstances.length === 0 ? <p className="muted">Create the first client WAO instance.</p> : null}
            <div className="wao-instance-list">
              {waoInstances.slice(0, 5).map((instance) => (
                <WaoInstanceCard key={instance.id} instance={instance} onOpen={onOpenWaoInstance} />
              ))}
            </div>
          </div>
        ) : null}

      </section>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [accessKeys, setAccessKeys] = useState<AccessKey[]>([]);
  const [waoInstances, setWaoInstances] = useState<WaoInstance[]>([]);
  const [selectedWaoInstanceId, setSelectedWaoInstanceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [wsConnected, setWsConnected] = useState(false);
  const [nexusRefresh, setNexusRefresh] = useState(0);
  const [nexusSendState, setNexusSendState] = useState<NexusSendState | null>(null);
  const pendingNexusMessagesRef = useRef(new Map<string, PendingNexusMessage>());
  const deliveryStatusesRef = useRef(new Map<string, DeliveryStatus>());
  const recentAgentRepliesRef = useRef(new Map<string, Message>());

  function openCorrelatedReply(message: Message, pendingMessageId: string, pending: PendingNexusMessage) {
    if (!isCorrelatedNexusReply(message, pendingMessageId, pending)) return;
    pendingNexusMessagesRef.current.delete(pendingMessageId);
    recentAgentRepliesRef.current.delete(pendingMessageId);
    setNexusSendState((current) => current?.messageId === pendingMessageId ? null : current);
  }

  async function recoverPendingNexusReplies() {
    const pending = [...pendingNexusMessagesRef.current.entries()];
    if (pending.length === 0) return;

    const messagesByChannel = new Map<string, Message[]>();
    await Promise.all([...new Set(pending.map(([, item]) => item.channelId))].map(async (channelId) => {
      const result = await api.listMessages(channelId);
      messagesByChannel.set(channelId, result.messages);
    }));

    for (const [pendingMessageId, pendingMessage] of pending) {
      const reply = messagesByChannel.get(pendingMessage.channelId)?.find((message) =>
        isCorrelatedNexusReply(message, pendingMessageId, pendingMessage)
      );
      if (reply) {
        openCorrelatedReply(reply, pendingMessageId, pendingMessage);
        return;
      }
    }
  }

  async function sendNexusMessage(agent: Agent, content: string) {
    setNexusSendState({
      agentId: agent.id,
      agentName: agent.displayName,
      messageId: null,
      channelId: null,
      deliveryId: null,
      status: "sending"
    });
    try {
      const result = await api.sendToAgent(agent.id, content);
      pendingNexusMessagesRef.current.set(result.message.id, { agentId: agent.id, channelId: result.channel.id });
      const deliveryId = result.delivery?.delivery.id ?? null;
      const eventStatus = deliveryId ? deliveryStatusesRef.current.get(deliveryId) : undefined;
      setNexusSendState({
        agentId: agent.id,
        agentName: agent.displayName,
        messageId: result.message.id,
        channelId: result.channel.id,
        deliveryId,
        status: eventStatus ?? result.delivery?.status ?? "queued"
      });
      const earlyReply = recentAgentRepliesRef.current.get(result.message.id);
      if (earlyReply) openCorrelatedReply(earlyReply, result.message.id, { agentId: agent.id, channelId: result.channel.id });
    } catch (error) {
      setNexusSendState(null);
      throw error;
    }
  }

  async function refresh() {
    const [cfg, me] = await Promise.all([api.config(), api.me()]);
    setConfig(cfg);
    setUser(me.user);
    setAgents(me.agents);
    if (me.user) {
      const [memberResult, accessKeyResult, instanceResult] = await Promise.all([
        api.listMembers(),
        api.listAccessKeys(),
        me.user.platformRole === "platform_admin" ? api.listWaoInstances() : Promise.resolve({ instances: [] })
      ]);
      setMembers(memberResult.members);
      setAccessKeys(accessKeyResult.accessKeys);
      setWaoInstances(instanceResult.instances);
    } else {
      setMembers([]);
      setAccessKeys([]);
      setWaoInstances([]);
    }
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    let disposed = false;
    let retryDelay = 1_000;
    let retryTimer: number | null = null;
    let ws: WebSocket | null = null;

    const handleMessage = (event: MessageEvent) => {
      const payload = JSON.parse(event.data) as BrowserEvent;
      if (payload.type === "agent_status") {
        setNexusRefresh((current) => current + 1);
        setAgents((current) =>
          current.map((agent) =>
            agent.id === payload.agentId
              ? { ...agent, connectedAt: payload.connected ? new Date().toISOString() : null }
              : agent
          )
        );
      }
      if (payload.type === "agent_revoked") {
        setNexusRefresh((current) => current + 1);
        setAgents((current) =>
          current.map((agent) =>
            agent.id === payload.agentId
              ? { ...agent, revokedAt: new Date().toISOString(), connectedAt: null }
              : agent
          )
        );
      }
      if (payload.type === "message") {
        setNexusRefresh((current) => current + 1);
        const message = payload.message;
        if (message.authorKind === "agent" && message.replyToMessageId) {
          recentAgentRepliesRef.current.set(message.replyToMessageId, message);
          if (recentAgentRepliesRef.current.size > 100) {
            const oldestReplyId = recentAgentRepliesRef.current.keys().next().value;
            if (oldestReplyId) recentAgentRepliesRef.current.delete(oldestReplyId);
          }
          const pending = pendingNexusMessagesRef.current.get(message.replyToMessageId);
          if (pending) openCorrelatedReply(message, message.replyToMessageId, pending);
        }
      }
      if (payload.type === "delivery_status") {
        const rank: Record<DeliveryStatus, number> = { queued: 0, sent: 1, received: 2 };
        const previous = deliveryStatusesRef.current.get(payload.deliveryId);
        const status = previous && rank[previous] > rank[payload.status] ? previous : payload.status;
        deliveryStatusesRef.current.set(payload.deliveryId, status);
        setNexusSendState((current) => current?.deliveryId === payload.deliveryId && rank[status] >= rank[current.status === "sending" ? "queued" : current.status]
          ? { ...current, status }
          : current);
      }
    };

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(browserWsUrl());
      ws = socket;
      socket.onopen = () => {
        if (disposed || ws !== socket) return;
        retryDelay = 1_000;
        setWsConnected(true);
        void recoverPendingNexusReplies().catch(() => undefined);
      };
      socket.onmessage = handleMessage;
      socket.onerror = () => {
        if (ws === socket) setWsConnected(false);
        socket.close();
      };
      socket.onclose = () => {
        if (disposed || ws !== socket) return;
        setWsConnected(false);
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      };
    };

    connect();
    return () => {
      disposed = true;
      setWsConnected(false);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [user?.id]);

  async function reloadLists() {
    const me = await api.me();
    setUser(me.user);
    setAgents(me.agents);
    if (me.user) {
      const [memberResult, accessKeyResult, instanceResult] = await Promise.all([
        api.listMembers(),
        api.listAccessKeys(),
        me.user.platformRole === "platform_admin" ? api.listWaoInstances() : Promise.resolve({ instances: [] })
      ]);
      setMembers(memberResult.members);
      setAccessKeys(accessKeyResult.accessKeys);
      setWaoInstances(instanceResult.instances);
    } else {
      setMembers([]);
      setAccessKeys([]);
      setWaoInstances([]);
    }
  }

  function openWaoInstance(instanceId: string) {
    setSelectedWaoInstanceId(instanceId);
    setActiveView("wao-instances");
  }

  function addWaoInstance(instance: WaoInstance) {
    setWaoInstances((current) => [instance, ...current.filter((item) => item.id !== instance.id)]);
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setAgents([]);
    setMembers([]);
    setAccessKeys([]);
    setWaoInstances([]);
    setSelectedWaoInstanceId(null);
    setActiveView("dashboard");
    setWsConnected(false);
    setNexusSendState(null);
    pendingNexusMessagesRef.current.clear();
    deliveryStatusesRef.current.clear();
    recentAgentRepliesRef.current.clear();
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
          <AppSidebar
            activeView={activeView}
            onChange={(view) => {
              if (view === "wao-instances") setSelectedWaoInstanceId(null);
              setActiveView(view);
            }}
            user={user}
            wsConnected={wsConnected}
            onLogout={() => void logout()}
          />
          <div className="main-workspace">
            {activeView === "dashboard" ? (
              <>
                <PageHeader title="Command Center" subtitle="Real-time overview of the AgentSync relay." live={wsConnected} />
                <DashboardView
                  agents={agents}
                  wsConnected={wsConnected}
                  user={user}
                  waoInstances={waoInstances}
                  onOpenWaoInstance={openWaoInstance}
                  onViewAllWaoInstances={() => {
                    setSelectedWaoInstanceId(null);
                    setActiveView("wao-instances");
                  }}
                />
              </>
            ) : null}

            {activeView === "wao-instances" && user.platformRole === "platform_admin" ? (
              <>
                <PageHeader title="WAO Instances" subtitle="Create and open client WAO instance shells." live={wsConnected} />
                <WaoInstancesView
                  instances={waoInstances}
                  members={members}
                  selectedId={selectedWaoInstanceId}
                  onSelect={setSelectedWaoInstanceId}
                  onCreated={addWaoInstance}
                />
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

            {activeView === "relays" ? <RelaysView agents={agents} onAgentsChanged={reloadLists} /> : null}

            {activeView === "providers" ? (
              <>
                <PageHeader title="Providers" subtitle="Store encrypted LLM provider API keys for future agent execution." live={wsConnected} />
                <ProvidersPanel />
              </>
            ) : null}

            {activeView === "comms" ? <NexusView live={wsConnected} refreshSignal={nexusRefresh} sendState={nexusSendState} onSendToAgent={sendNexusMessage} /> : null}
          </div>
        </div>
      )}
    </main>
  );
}
