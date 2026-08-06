import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, browserWsUrl } from "./lib/api";
import { isCorrelatedNexusReply, type PendingNexusMessage } from "./lib/nexusReply.js";
import { PROVIDERS, providerLabel } from "./lib/providers";
import { RelaysView } from "./components/relays/RelaysView";
import { NexusView } from "./components/nexus/NexusView";
import type { AccessKey, Agent, AgentSystemType, BrowserEvent, Channel, Config, DeliveryStatus, Message, NexusSendState, ProviderKey, User } from "./types";
import waoBadgeUrl from "./wao-badge.svg";
import "./styles.css";

type Authorization = Awaited<ReturnType<typeof api.authorizeAgent>>;
type IssuedAccessKey = Awaited<ReturnType<typeof api.createAccessKey>>;
type AppView = "dashboard" | "agents" | "relays" | "providers" | "nexus" | "access" | "chat";

const navItems: Array<{ id: AppView; label: string; icon: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "DB" },
  { id: "agents", label: "Agents", icon: "AG" },
  { id: "access", label: "Access", icon: "AK" },
  { id: "chat", label: "Chat", icon: "CH" },
  { id: "relays", label: "Relays", icon: "RL" },
  { id: "providers", label: "Providers", icon: "PR" },
  { id: "nexus", label: "Nexus", icon: "NX" }
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
        You authorize an agent once. It can reconnect any time â€” whether or not you are online â€” until you revoke it.
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
                {agent.systemLabel ?? "Unknown system"} Â· {agent.systemType ?? "other"} Â· authorized {new Date(agent.createdAt).toLocaleString()}
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
                {(accessKey.agents ?? []).length === 0 ? <small className="muted">No agents authorized byã~õ¶‰žËkºwµç@€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…•¹ÐµÑ¥±”µÉ¥ˆø4(€€€€€€€€€€€í±…Ñ•ÍÑ•¹ÑÌ¹±•¹Ñ €ôôô€À€ü€ñÀ±…ÍÍ9…µ”ô‰µÕÑ•ˆù9¼…•¹ÑÌ½¹¹•Ñ•å•Ð¸ð½Àø€è¹Õ±±ô4(€€€€€€€€€€€í±…Ñ•ÍÑ•¹ÑÌ¹µ…À ¡…•¹Ð¤€ôø€ 4(€€€€€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”õí…•¹Ð¹½¹¹•Ñ•‘Ð€ü€‰…•¹ÐµÑ¥±”½¹±¥¹”ˆ€è€‰…•¹ÐµÑ¥±”‰ô­•äõí…•¹Ð¹¥‘ôø4(€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…•¹Ðµ…Ù…Ñ…Èˆùí¥¹¥Ñ¥…±Ì¡…•¹Ð¹‘¥ÍÁ±…å9…µ”¥ôð½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí…•¹Ð¹‘¥ÍÁ±…å9…µ•ôð½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€ñÍµ…±°ùí…•¹Ð¹ÍåÍÑ•µ1…‰•°€üü€¡…•¹Ð¹½¹¹•Ñ•‘Ð€ü€‰=¹±¥¹”ˆ€è€‰=™™±¥¹”ˆ¥ôð½Íµ…±°ø4(€€€€€€€€€€€€€€ð½…ÉÑ¥±”ø4(€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€ð½‘¥Øø4(4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°ˆø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µ¡•…‘•Èˆø4(€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰•å•‰É½Üˆù]½É­ÍÁ…•Ìð½Àø4(€€€€€€€€€€€€€€ñ Èù¡…¹¹•±Ìð½ Èø4(€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½µÁ…Ðµ±¥ÍÐˆø4(€€€€€€€€€€€í±…Ñ•ÍÑ¡…¹¹•±Ì¹±•¹Ñ €ôôô€À€ü€ñÀ±…ÍÍ9…µ”ô‰µÕÑ•ˆùÉ•…Ñ”å½ÕÈ™¥ÉÍÐ¡…¹¹•°™É½´¡…Ð¸ð½Àø€è¹Õ±±ô4(€€€€€€€€€€€í±…Ñ•ÍÑ¡…¹¹•±Ì¹µ…À ¡¡…¹¹•°¤€ôø€ 4(€€€€€€€€€€€€€€ñ…ÉÑ¥±”­•äõí¡…¹¹•°¹¥‘ôø4(€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí¡…¹¹•°¹¹…µ•ôð½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€ñÍµ…±°ùí¡…¹¹•°¹µ•µ‰•ÉÌ¹±•¹Ñ¡ôµ•µ‰•ÉÌð½Íµ…±°ø4(€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€€í¡…¹¹•°¹…•¹ÑMÑÉ•…­½Õ¹Ð€ø€Ø€ü€ñÍÁ…¸±…ÍÍ9…µ”ô‰‰…‘”Ý…É¹¥¹œˆùÕ…Éð½ÍÁ…¸ø€è¹Õ±±ô4(€€€€€€€€€€€€€€ð½…ÉÑ¥±”ø4(€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€ð½‘¥Øø4(€€€€€€ð½Í•Ñ¥½¸ø4(€€€€ð½‘¥Øø4(€€¤ì4)ô4(4)•áÁ½ÉÐ‘•™…Õ±Ð™Õ¹Ñ¥½¸ÁÀ ¤ì4(€½¹ÍÐm½¹™¥œ°Í•Ñ½¹™¥t€ôÕÍ•MÑ…Ñ”ñ½¹™¥œð¹Õ±°ø¡¹Õ±°¤ì4(€½¹ÍÐmÕÍ•È°Í•ÑUÍ•Ét€ôÕÍ•MÑ…Ñ”ñUÍ•Èð¹Õ±°ø¡¹Õ±°¤ì4(€½¹ÍÐm…•¹ÑÌ°Í•Ñ•¹ÑÍt€ôÕÍ•MÑ…Ñ”ñ•¹Ñmtø¡mt¤ì4(€½¹ÍÐm¡…¹¹•±Ì°Í•Ñ¡…¹¹•±Ít€ôÕÍ•MÑ…Ñ”ñ¡…¹¹•±mtø¡mt¤ì4(€½¹ÍÐmµ•µ‰•ÉÌ°Í•Ñ5•µ‰•ÉÍt€ôÕÍ•MÑ…Ñ”ñUÍ•Émtø¡mt¤ì4(€½¹ÍÐm…•ÍÍ-•åÌ°Í•Ñ•ÍÍ-•åÍt€ôÕÍ•MÑ…Ñ”ñ•ÍÍ-•åmtø¡mt¤ì4(€½¹ÍÐmÍ•±•Ñ•‘¡…¹¹•±%°Í•ÑM•±•Ñ•‘¡…¹¹•±%‘t€ôÕÍ•MÑ…Ñ”ñÍÑÉ¥¹œð¹Õ±°ø¡¹Õ±°¤ì4(€½¹ÍÐmµ•ÍÍ…•Ì°Í•Ñ5•ÍÍ…•Ít€ôÕÍ•MÑ…Ñ”ñ5•ÍÍ…•mtø¡mt¤ì4(€½¹ÍÐm±½…‘¥¹œ°Í•Ñ1½…‘¥¹t€ôÕÍ•MÑ…Ñ”¡ÑÉÕ”¤ì4(€½¹ÍÐm…Ñ¥Ù•Y¥•Ü°Í•ÑÑ¥Ù•Y¥•Ýt€ôÕÍ•MÑ…Ñ”ñÁÁY¥•Üø ‰‘…Í¡‰½…Éˆ¤ì4(€½¹ÍÐmÝÍ½¹¹•Ñ•°Í•Ñ]Í½¹¹•Ñ•‘t€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì4(€½¹ÍÐm¹•áÕÍI•™É•Í °Í•Ñ9•áÕÍI•™É•Í¡t€ôÕÍ•MÑ…Ñ” À¤ì4(€½¹ÍÐm¹•áÕÍM•¹‘MÑ…Ñ”°Í•Ñ9•áÕÍM•¹‘MÑ…Ñ•t€ôÕÍ•MÑ…Ñ”ñ9•áÕÍM•¹‘MÑ…Ñ”ð¹Õ±°ø¡¹Õ±°¤ì4(€½¹ÍÐÁ•¹‘¥¹9•áÕÍ5•ÍÍ…•ÍI•˜€ôÕÍ•I•˜¡¹•Ü5…ÀñÍÑÉ¥¹œ°A•¹‘¥¹9•áÕÍ5•ÍÍ…”ø ¤¤ì(€½¹ÍÐ‘•±¥Ù•ÉåMÑ…ÑÕÍ•ÍI•˜€ôÕÍ•I•˜¡¹•Ü5…ÀñÍÑÉ¥¹œ°•±¥Ù•ÉåMÑ…ÑÕÌø ¤¤ì(€½¹ÍÐÉ••¹Ñ•¹ÑI•Á±¥•ÍI•˜€ôÕÍ•I•˜¡¹•Ü5…ÀñÍÑÉ¥¹œ°5•ÍÍ…”ø ¤¤ì(€½¹ÍÐÍ•±•Ñ•‘¡…¹¹•±%‘I•˜€ôÕÍ•I•˜ñÍÑÉ¥¹œð¹Õ±°ø¡¹Õ±°¤ì(4(€™Õ¹Ñ¥½¸µ•É•¡…¹¹•°¡¡…¹¹•°è¡…¹¹•°¤ì4(€€€Í•Ñ¡…¹¹•±Ì ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ð¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôô¡…¹¹•°¹¥¤4(€€€€€€üÕÉÉ•¹Ð¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôô¡…¹¹•°¹¥€ü¡…¹¹•°€è¥Ñ•´¤4(€€€€€€èm¡…¹¹•°°€¸¸¹ÕÉÉ•¹Ñt¤ì4(€ô4(4(€™Õ¹Ñ¥½¸½Á•¹½ÉÉ•±…Ñ•‘I•Á±ä¡µ•ÍÍ…”è5•ÍÍ…”°Á•¹‘¥¹5•ÍÍ…•%èÍÑÉ¥¹œ°Á•¹‘¥¹œèA•¹‘¥¹9•áÕÍ5•ÍÍ…”¤ì(€€€¥˜€ …¥Í½ÉÉ•±…Ñ•‘9•áÕÍI•Á±ä¡µ•ÍÍ…”°Á•¹‘¥¹5•ÍÍ…•%°Á•¹‘¥¹œ¤¤É•ÑÕÉ¸ì(€€€Á•¹‘¥¹9•áÕÍ5•ÍÍ…•ÍI•˜¹ÕÉÉ•¹Ð¹‘•±•Ñ”¡Á•¹‘¥¹5•ÍÍ…•%¤ì(€€€É••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹‘•±•Ñ”¡Á•¹‘¥¹5•ÍÍ…•%¤ì(€€€Í•Ñ9•áÕÍM•¹‘MÑ…Ñ” ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ðü¹µ•ÍÍ…•%€ôôôÁ•¹‘¥¹5•ÍÍ…•%€ü¹Õ±°€èÕÉÉ•¹Ð¤ì(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸É•½Ù•ÉA•¹‘¥¹9•áÕÍI•Á±¥•Ì ¤ì(€€€½¹ÍÐÁ•¹‘¥¹œ€ôl¸¸¹Á•¹‘¥¹9•áÕÍ5•ÍÍ…•ÍI•˜¹ÕÉÉ•¹Ð¹•¹ÑÉ¥•Ì ¥tì(€€€¥˜€¡Á•¹‘¥¹œ¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì((€€€½¹ÍÐµ•ÍÍ…•Í	å¡…¹¹•°€ô¹•Ü5…ÀñÍÑÉ¥¹œ°5•ÍÍ…•mtø ¤ì(€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l¸¸¹¹•ÜM•Ð¡Á•¹‘¥¹œ¹µ…À ¡l°¥Ñ•µt¤€ôø¥Ñ•´¹¡…¹¹•±%¤¥t¹µ…À¡…Íå¹Œ€¡¡…¹¹•±%¤€ôøì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð…Á¤¹±¥ÍÑ5•ÍÍ…•Ì¡¡…¹¹•±%¤ì(€€€€€µ•ÍÍ…•Í	å¡…¹¹•°¹Í•Ð¡¡…¹¹•±%°É•ÍÕ±Ð¹µ•ÍÍ…•Ì¤ì(€€€ô¤¤ì((€€€™½È€¡½¹ÍÐmÁ•¹‘¥¹5•ÍÍ…•%°Á•¹‘¥¹5•ÍÍ…•t½˜Á•¹‘¥¹œ¤ì(€€€€€½¹ÍÐÉ•Á±ä€ôµ•ÍÍ…•Í	å¡…¹¹•°¹•Ð¡Á•¹‘¥¹5•ÍÍ…”¹¡…¹¹•±%¤ü¹™¥¹ ¡µ•ÍÍ…”¤€ôø(€€€€€€€¥Í½ÉÉ•±…Ñ•‘9•áÕÍI•Á±ä¡µ•ÍÍ…”°Á•¹‘¥¹5•ÍÍ…•%°Á•¹‘¥¹5•ÍÍ…”¤(€€€€€€¤ì(€€€€€¥˜€¡É•Á±ä¤ì(€€€€€€€½Á•¹½ÉÉ•±…Ñ•‘I•Á±ä¡É•Á±ä°Á•¹‘¥¹5•ÍÍ…•%°Á•¹‘¥¹5•ÍÍ…”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€ô(€ô(4(€…Íå¹Œ™Õ¹Ñ¥½¸Í•¹‘9•áÕÍ5•ÍÍ…”¡…•¹Ðè•¹Ð°½¹Ñ•¹ÐèÍÑÉ¥¹œ¤ì4(€€€Í•Ñ9•áÕÍM•¹‘MÑ…Ñ”¡ì4(€€€€€…•¹Ñ%è…•¹Ð¹¥°4(€€€€€…•¹Ñ9…µ”è…•¹Ð¹‘¥ÍÁ±…å9…µ”°4(€€€€€µ•ÍÍ…•%è¹Õ±°°4(€€€€€¡…¹¹•±%è¹Õ±°°4(€€€€€‘•±¥Ù•Éå%è¹Õ±°°4(€€€€€ÍÑ…ÑÕÌè€‰Í•¹‘¥¹œˆ4(€€€ô¤ì4(€€€ÑÉäì4(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð…Á¤¹Í•¹‘Q½•¹Ð¡…•¹Ð¹¥°½¹Ñ•¹Ð¤ì4(€€€€€µ•É•¡…¹¹•°¡É•ÍÕ±Ð¹¡…¹¹•°¤ì4(€€€€€Á•¹‘¥¹9•áÕÍ5•ÍÍ…•ÍI•˜¹ÕÉÉ•¹Ð¹Í•Ð¡É•ÍÕ±Ð¹µ•ÍÍ…”¹¥°ì…•¹Ñ%è…•¹Ð¹¥°¡…¹¹•±%èÉ•ÍÕ±Ð¹¡…¹¹•°¹¥ô¤ì4(€€€€€½¹ÍÐ‘•±¥Ù•Éå%€ôÉ•ÍÕ±Ð¹‘•±¥Ù•Éäü¹‘•±¥Ù•Éä¹¥€üü¹Õ±°ì4(€€€€€½¹ÍÐ•Ù•¹ÑMÑ…ÑÕÌ€ô‘•±¥Ù•Éå%€ü‘•±¥Ù•ÉåMÑ…ÑÕÍ•ÍI•˜¹ÕÉÉ•¹Ð¹•Ð¡‘•±¥Ù•Éå%¤€èÕ¹‘•™¥¹•ì4(€€€€€Í•Ñ9•áÕÍM•¹‘MÑ…Ñ”¡ì4(€€€€€€€…•¹Ñ%è…•¹Ð¹¥°4(€€€€€€€…•¹Ñ9…µ”è…•¹Ð¹‘¥ÍÁ±…å9…µ”°4(€€€€€€€µ•ÍÍ…•%èÉ•ÍÕ±Ð¹µ•ÍÍ…”¹¥°4(€€€€€€€¡…¹¹•±%èÉ•ÍÕ±Ð¹¡…¹¹•°¹¥°4(€€€€€€€‘•±¥Ù•Éå%°4(€€€€€€€ÍÑ…ÑÕÌè•Ù•¹ÑMÑ…ÑÕÌ€üüÉ•ÍÕ±Ð¹‘•±¥Ù•Éäü¹ÍÑ…ÑÕÌ€üü€‰ÅÕ•Õ•ˆ4(€€€€€ô¤ì4(€€€€€½¹ÍÐ•…É±åI•Á±ä€ôÉ••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹•Ð¡É•ÍÕ±Ð¹µ•ÍÍ…”¹¥¤ì4(€€€€€¥˜€¡•…É±åI•Á±ä¤½Á•¹½ÉÉ•±…Ñ•‘I•Á±ä¡•…É±åI•Á±ä°É•ÍÕ±Ð¹µ•ÍÍ…”¹¥°ì…•¹Ñ%è…•¹Ð¹¥°¡…¹¹•±%èÉ•ÍÕ±Ð¹¡…¹¹•°¹¥ô¤ì4(€€€ô…Ñ €¡•ÉÉ½È¤ì4(€€€€€Í•Ñ9•áÕÍM•¹‘MÑ…Ñ”¡¹Õ±°¤ì4(€€€€€Ñ¡É½Ü•ÉÉ½Èì4(€€€ô4(€ô4(4(€…Íå¹Œ™Õ¹Ñ¥½¸É•™É•Í  ¤ì4(€€€½¹ÍÐm™œ°µ•t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m…Á¤¹½¹™¥œ ¤°…Á¤¹µ” ¥t¤ì4(€€€Í•Ñ½¹™¥œ¡™œ¤ì4(€€€Í•ÑUÍ•È¡µ”¹ÕÍ•È¤ì4(€€€Í•Ñ•¹ÑÌ¡µ”¹…•¹ÑÌ¤ì4(€€€Í•Ñ¡…¹¹•±Ì¡µ”¹¡…¹¹•±Ì¤ì4(€€€¥˜€¡µ”¹ÕÍ•È¤ì4(€€€€€½¹ÍÐmµ•µ‰•ÉI•ÍÕ±Ð°…•ÍÍ-•åI•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m…Á¤¹±¥ÍÑ5•µ‰•ÉÌ ¤°…Á¤¹±¥ÍÑ•ÍÍ-•åÌ ¥t¤ì4(€€€€€Í•Ñ5•µ‰•ÉÌ¡µ•µ‰•ÉI•ÍÕ±Ð¹µ•µ‰•ÉÌ¤ì4(€€€€€Í•Ñ•ÍÍ-•åÌ¡…•ÍÍ-•åI•ÍÕ±Ð¹…•ÍÍ-•åÌ¤ì4(€€€ô•±Í”ì4(€€€€€Í•Ñ5•µ‰•ÉÌ¡mt¤ì4(€€€€€Í•Ñ•ÍÍ-•åÌ¡mt¤ì4(€€€ô4(€€€½¹ÍÐ™¥ÉÍÑ¡…¹¹•°€ôµ”¹¡…¹¹•±Ì¹™¥¹ ¡¡…¹¹•°¤€ôø¡…¹¹•°¹­¥¹€„ôô€‰‘´ˆ¤€üüµ”¹¡…¹¹•±ÍlÁtì4(€€€¥˜€ …Í•±•Ñ•‘¡…¹¹•±%ñð€…µ”¹¡…¹¹•±Ì¹Í½µ” ¡¡…¹¹•°¤€ôø¡…¹¹•°¹¥€ôôôÍ•±•Ñ•‘¡…¹¹•±%¤¤ì4(€€€€€Í•ÑM•±•Ñ•‘¡…¹¹•±%¡™¥ÉÍÑ¡…¹¹•°ü¹¥€üü¹Õ±°¤ì4(€€€ô4(€ô4(4(€ÕÍ•™™•Ð  ¤€ôøì(€€€Ù½¥É•™É•Í  ¤¹™¥¹…±±ä  ¤€ôøÍ•Ñ1½…‘¥¹œ¡™…±Í”¤¤ì(€ô°mt¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€Í•±•Ñ•‘¡…¹¹•±%‘I•˜¹ÕÉÉ•¹Ð€ôÍ•±•Ñ•‘¡…¹¹•±%ì(€ô°mÍ•±•Ñ•‘¡…¹¹•±%‘t¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€ …ÕÍ•È¤É•ÑÕÉ¸ì(€€€±•Ð‘¥ÍÁ½Í•€ô™…±Í”ì(€€€±•ÐÉ•ÑÉå•±…ä€ô€Å|ÀÀÀì(€€€±•ÐÉ•ÑÉåQ¥µ•Èè¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€±•ÐÝÌè]•‰M½­•Ðð¹Õ±°€ô¹Õ±°ì((€€€½¹ÍÐ¡…¹‘±•5•ÍÍ…”€ô€¡•Ù•¹Ðè5•ÍÍ…•Ù•¹Ð¤€ôøì(€€€€€½¹ÍÐÁ…å±½…€ô)M=8¹Á…ÉÍ”¡•Ù•¹Ð¹‘…Ñ„¤…Ì	É½ÝÍ•ÉÙ•¹Ðì(€€€€€¥˜€¡Á…å±½…¹ÑåÁ”€ôôô€‰…•¹Ñ}ÍÑ…ÑÕÌˆ¤ì4(€€€€€€€Í•Ñ9•áÕÍI•™É•Í  ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ð€¬€Ä¤ì4(€€€€€€€Í•Ñ•¹ÑÌ ¡ÕÉÉ•¹Ð¤€ôø4(€€€€€€€€€ÕÉÉ•¹Ð¹µ…À ¡…•¹Ð¤€ôø4(€€€€€€€€€€€…•¹Ð¹¥€ôôôÁ…å±½…¹…•¹Ñ%4(€€€€€€€€€€€€€€üì€¸¸¹…•¹Ð°½¹¹•Ñ•‘ÐèÁ…å±½…¹½¹¹•Ñ•€ü¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤€è¹Õ±°ô4(€€€€€€€€€€€€€€è…•¹Ð4(€€€€€€€€€€¤4(€€€€€€€€¤ì4(€€€€€ô4(€€€€€¥˜€¡Á…å±½…¹ÑåÁ”€ôôô€‰…•¹Ñ}É•Ù½­•ˆ¤ì4(€€€€€€€Í•Ñ9•áÕÍI•™É•Í  ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ð€¬€Ä¤ì4(€€€€€€€Í•Ñ•¹ÑÌ ¡ÕÉÉ•¹Ð¤€ôø4(€€€€€€€€€ÕÉÉ•¹Ð¹µ…À ¡…•¹Ð¤€ôø4(€€€€€€€€€€€…•¹Ð¹¥€ôôôÁ…å±½…¹…•¹Ñ%4(€€€€€€€€€€€€€€üì€¸¸¹…•¹Ð°É•Ù½­•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°½¹¹•Ñ•‘Ðè¹Õ±°ô4(€€€€€€€€€€€€€€è…•¹Ð4(€€€€€€€€€€¤4(€€€€€€€€¤ì4(€€€€€ô4(€€€€€¥˜€¡Á…å±½…¹ÑåÁ”€ôôô€‰µ•ÍÍ…”ˆ¤ì4(€€€€€€€Í•Ñ9•áÕÍI•™É•Í  ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ð€¬€Ä¤ì4(€€€€€€€½¹ÍÐµ•ÍÍ…”€ôÁ…å±½…¹µ•ÍÍ…”ì4(€€€€€€€¥˜€¡µ•ÍÍ…”¹¡…¹¹•±%€ôôôÍ•±•Ñ•‘¡…¹¹•±%‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€Í•Ñ5•ÍÍ…•Ì ¡ÕÉÉ•¹Ð¤€ôø€¡ÕÉÉ•¹Ð¹Í½µ” ¡¥Ñ•´¤€ôø¥Ñ•´¹¥€ôôôµ•ÍÍ…”¹¥¤€üÕÉÉ•¹Ð€èl¸¸¹ÕÉÉ•¹Ð°µ•ÍÍ…•t¤¤ì4(€€€€€€€ô4(€€€€€€€¥˜€¡µ•ÍÍ…”¹…ÕÑ¡½É-¥¹€ôôô€‰…•¹Ðˆ€˜˜µ•ÍÍ…”¹É•Á±åQ½5•ÍÍ…•%¤ì4(€€€€€€€€€É••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹Í•Ð¡µ•ÍÍ…”¹É•Á±åQ½5•ÍÍ…•%°µ•ÍÍ…”¤ì4(€€€€€€€€€¥˜€¡É••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹Í¥é”€ø€ÄÀÀ¤ì4(€€€€€€€€€€€½¹ÍÐ½±‘•ÍÑI•Á±å%€ôÉ••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹­•åÌ ¤¹¹•áÐ ¤¹Ù…±Õ”ì4(€€€€€€€€€€€¥˜€¡½±‘•ÍÑI•Á±å%¤É••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹‘•±•Ñ”¡½±‘•ÍÑI•Á±å%¤ì4(€€€€€€€€€ô4(€€€€€€€€€½¹ÍÐÁ•¹‘¥¹œ€ôÁ•¹‘¥¹9•áÕÍ5•ÍÍ…•ÍI•˜¹ÕÉÉ•¹Ð¹•Ð¡µ•ÍÍ…”¹É•Á±åQ½5•ÍÍ…•%¤ì4(€€€€€€€€€¥˜€¡Á•¹‘¥¹œ¤½Á•¹½ÉÉ•±…Ñ•‘I•Á±ä¡µ•ÍÍ…”°µ•ÍÍ…”¹É•Á±åQ½5•ÍÍ…•%°Á•¹‘¥¹œ¤ì4(€€€€€€€ô4(€€€€€ô4(€€€€€¥˜€¡Á…å±½…¹ÑåÁ”€ôôô€‰‘•±¥Ù•Éå}ÍÑ…ÑÕÌˆ¤ì4(€€€€€€€½¹ÍÐÉ…¹¬èI•½Éñ•±¥Ù•ÉåMÑ…ÑÕÌ°¹Õµ‰•Èø€ôìÅÕ•Õ•è€À°Í•¹Ðè€Ä°É••¥Ù•è€Èôì4(€€€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô‘•±¥Ù•ÉåMÑ…ÑÕÍ•ÍI•˜¹ÕÉÉ•¹Ð¹•Ð¡Á…å±½…¹‘•±¥Ù•Éå%¤ì4(€€€€€€€½¹ÍÐÍÑ…ÑÕÌ€ôÁÉ•Ù¥½ÕÌ€˜˜É…¹­mÁÉ•Ù¥½ÕÍt€øÉ…¹­mÁ…å±½…¹ÍÑ…ÑÕÍt€üÁÉ•Ù¥½ÕÌ€èÁ…å±½…¹ÍÑ…ÑÕÌì4(€€€€€€€‘•±¥Ù•ÉåMÑ…ÑÕÍ•ÍI•˜¹ÕÉÉ•¹Ð¹Í•Ð¡Á…å±½…¹‘•±¥Ù•Éå%°ÍÑ…ÑÕÌ¤ì4(€€€€€€€Í•Ñ9•áÕÍM•¹‘MÑ…Ñ” ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ðü¹‘•±¥Ù•Éå%€ôôôÁ…å±½…¹‘•±¥Ù•Éå%€˜˜É…¹­mÍÑ…ÑÕÍt€øôÉ…¹­mÕÉÉ•¹Ð¹ÍÑ…ÑÕÌ€ôôô€‰Í•¹‘¥¹œˆ€ü€‰ÅÕ•Õ•ˆ€èÕÉÉ•¹Ð¹ÍÑ…ÑÕÍt4(€€€€€€€€€€üì€¸¸¹ÕÉÉ•¹Ð°ÍÑ…ÑÕÌô4(€€€€€€€€€€èÕÉÉ•¹Ð¤ì4(€€€€€ô4(€€€€€¥˜€¡Á…å±½…¹ÑåÁ”€ôôô€‰µ•ÍÍ…•}ÕÁ‘…Ñ•ˆ¤ì(€€€€€€€½¹ÍÐµ•ÍÍ…”€ôÁ…å±½…¹µ•ÍÍ…”ì4(€€€€€€€Í•Ñ5•ÍÍ…•Ì ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ð¹µ…À ¡¥Ñ•´¤€ôø€¡¥Ñ•´¹¥€ôôôµ•ÍÍ…”¹¥€üµ•ÍÍ…”€è¥Ñ•´¤¤¤ì4(€€€€€ô(€€€ôì((€€€½¹ÍÐ½¹¹•Ð€ô€ ¤€ôøì(€€€€€¥˜€¡‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐÍ½­•Ð€ô¹•Ü]•‰M½­•Ð¡‰É½ÝÍ•É]ÍUÉ° ¤¤ì(€€€€€ÝÌ€ôÍ½­•Ðì(€€€€€Í½­•Ð¹½¹½Á•¸€ô€ ¤€ôøì(€€€€€€€¥˜€¡‘¥ÍÁ½Í•ñðÝÌ€„ôôÍ½­•Ð¤É•ÑÕÉ¸ì(€€€€€€€É•ÑÉå•±…ä€ô€Å|ÀÀÀì(€€€€€€€Í•Ñ]Í½¹¹•Ñ•¡ÑÉÕ”¤ì(€€€€€€€Ù½¥AÉ½µ¥Í”¹…±°¡l(€€€€€€€€€…Á¤¹±¥ÍÑ¡…¹¹•±Ì ¤¹Ñ¡•¸ ¡É•ÍÕ±Ð¤€ôøÍ•Ñ¡…¹¹•±Ì¡É•ÍÕ±Ð¹¡…¹¹•±Ì¤¤°(€€€€€€€€€É•½Ù•ÉA•¹‘¥¹9•áÕÍI•Á±¥•Ì ¤(€€€€€€€t¤¹…Ñ   ¤€ôøÕ¹‘•™¥¹•¤ì(€€€€€ôì(€€€€€Í½­•Ð¹½¹µ•ÍÍ…”€ô¡…¹‘±•5•ÍÍ…”ì(€€€€€Í½­•Ð¹½¹•ÉÉ½È€ô€ ¤€ôøì(€€€€€€€¥˜€¡ÝÌ€ôôôÍ½­•Ð¤Í•Ñ]Í½¹¹•Ñ•¡™…±Í”¤ì(€€€€€€€Í½­•Ð¹±½Í” ¤ì(€€€€€ôì(€€€€€Í½­•Ð¹½¹±½Í”€ô€ ¤€ôøì(€€€€€€€¥˜€¡‘¥ÍÁ½Í•ñðÝÌ€„ôôÍ½­•Ð¤É•ÑÕÉ¸ì(€€€€€€€Í•Ñ]Í½¹¹•Ñ•¡™…±Í”¤ì(€€€€€€€É•ÑÉåQ¥µ•È€ôÝ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕÐ¡½¹¹•Ð°É•ÑÉå•±…ä¤ì(€€€€€€€É•ÑÉå•±…ä€ô5…Ñ ¹µ¥¸¡É•ÑÉå•±…ä€¨€È°€ÄÕ|ÀÀÀ¤ì(€€€€€ôì(€€€ôì((€€€½¹¹•Ð ¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€€€Í•Ñ]Í½¹¹•Ñ•¡™…±Í”¤ì(€€€€€¥˜€¡É•ÑÉåQ¥µ•È€„ôô¹Õ±°¤Ý¥¹‘½Ü¹±•…ÉQ¥µ•½ÕÐ¡É•ÑÉåQ¥µ•È¤ì(€€€€€ÝÌü¹±½Í” ¤ì(€€€ôì(€ô°mÕÍ•Èü¹¥‘t¤ì(4(€ÕÍ•™™•Ð  ¤€ôøì4(€€€¥˜€ …Í•±•Ñ•‘¡…¹¹•±%¤ì4(€€€€€Í•Ñ5•ÍÍ…•Ì¡mt¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€Ù½¥…Á¤¹±¥ÍÑ5•ÍÍ…•Ì¡Í•±•Ñ•‘¡…¹¹•±%¤¹Ñ¡•¸ ¡É•ÍÕ±Ð¤€ôøÍ•Ñ5•ÍÍ…•Ì¡É•ÍÕ±Ð¹µ•ÍÍ…•Ì¤¤ì4(€ô°mÍ•±•Ñ•‘¡…¹¹•±%‘t¤ì4(4(€½¹ÍÐÍ¡…É•‘¡…¹¹•±Ì€ôÕÍ•5•µ¼  ¤€ôø¡…¹¹•±Ì¹™¥±Ñ•È ¡¡…¹¹•°¤€ôø¡…¹¹•°¹­¥¹€„ôô€‰‘´ˆ¤°m¡…¹¹•±Ít¤ì4(€½¹ÍÐÍ•±•Ñ•‘¡…¹¹•°€ôÕÍ•5•µ¼ 4(€€€€ ¤€ôø¡…¹¹•±Ì¹™¥¹ ¡¡…¹¹•°¤€ôø¡…¹¹•°¹¥€ôôôÍ•±•Ñ•‘¡…¹¹•±%¤€üü¹Õ±°°4(€€€m¡…¹¹•±Ì°Í•±•Ñ•‘¡…¹¹•±%‘t4(€€¤ì4(€½¹ÍÐÍ•±•Ñ•‘¡…¹¹•±Q¥Ñ±”€ôÕÍ•5•µ¼  ¤€ôøì4(€€€¥˜€ …Í•±•Ñ•‘¡…¹¹•°¤É•ÑÕÉ¸€ˆˆì4(€€€¥˜€¡Í•±•Ñ•‘¡…¹¹•°¹­¥¹€„ôô€‰‘´ˆ¤É•ÑÕÉ¸Í•±•Ñ•‘¡…¹¹•°¹¹…µ”ì4(€€€É•ÑÕÉ¸…•¹ÑÌ¹™¥¹ ¡…•¹Ð¤€ôø…•¹Ð¹¥€ôôôÍ•±•Ñ•‘¡…¹¹•°¹‘µ•¹Ñ%¤ü¹‘¥ÍÁ±…å9…µ”€üü€‰¥É•Ðµ•ÍÍ…”ˆì4(€ô°m…•¹ÑÌ°Í•±•Ñ•‘¡…¹¹•±t¤ì4(4(€…Íå¹Œ™Õ¹Ñ¥½¸É•±½…‘1¥ÍÑÌ ¤ì4(€€€½¹ÍÐµ”€ô…Ý…¥Ð…Á¤¹µ” ¤ì4(€€€Í•ÑUÍ•È¡µ”¹ÕÍ•È¤ì4(€€€Í•Ñ•¹ÑÌ¡µ”¹…•¹ÑÌ¤ì4(€€€Í•Ñ¡…¹¹•±Ì¡µ”¹¡…¹¹•±Ì¤ì4(€€€¥˜€ …µ”¹¡…¹¹•±Ì¹Í½µ” ¡¡…¹¹•°¤€ôø¡…¹¹•°¹¥€ôôôÍ•±•Ñ•‘¡…¹¹•±%¤¤ì4(€€€€€Í•ÑM•±•Ñ•‘¡…¹¹•±% ¡µ”¹¡…¹¹•±Ì¹™¥¹ ¡¡…¹¹•°¤€ôø¡…¹¹•°¹­¥¹€„ôô€‰‘´ˆ¤€üüµ”¹¡…¹¹•±ÍlÁt¤ü¹¥€üü¹Õ±°¤ì4(€€€ô4(€€€¥˜€¡µ”¹ÕÍ•È¤ì4(€€€€€½¹ÍÐmµ•µ‰•ÉI•ÍÕ±Ð°…•ÍÍ-•åI•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡m…Á¤¹±¥ÍÑ5•µ‰•ÉÌ ¤°…Á¤¹±¥ÍÑ•ÍÍ-•åÌ ¥t¤ì4(€€€€€Í•Ñ5•µ‰•ÉÌ¡µ•µ‰•ÉI•ÍÕ±Ð¹µ•µ‰•ÉÌ¤ì4(€€€€€Í•Ñ•ÍÍ-•åÌ¡…•ÍÍ-•åI•ÍÕ±Ð¹…•ÍÍ-•åÌ¤ì4(€€€ô•±Í”ì4(€€€€€Í•Ñ5•µ‰•ÉÌ¡mt¤ì4(€€€€€Í•Ñ•ÍÍ-•åÌ¡mt¤ì4(€€€ô4(€ô4(4(€…Íå¹Œ™Õ¹Ñ¥½¸Í•¹‘5•ÍÍ…”¡½¹Ñ•¹ÐèÍÑÉ¥¹œ¤ì4(€€€¥˜€ …Í•±•Ñ•‘¡…¹¹•±%¤É•ÑÕÉ¸ì4(€€€…Ý…¥Ð…Á¤¹Í•¹‘5•ÍÍ…”¡Í•±•Ñ•‘¡…¹¹•±%°½¹Ñ•¹Ð¤ì4(€ô4(4(€…Íå¹Œ™Õ¹Ñ¥½¸±½½ÕÐ ¤ì4(€€€…Ý…¥Ð…Á¤¹±½½ÕÐ ¤ì4(€€€Í•ÑUÍ•È¡¹Õ±°¤ì4(€€€Í•Ñ•¹ÑÌ¡mt¤ì4(€€€Í•Ñ¡…¹¹•±Ì¡mt¤ì4(€€€Í•Ñ5•µ‰•ÉÌ¡mt¤ì4(€€€Í•Ñ•ÍÍ-•åÌ¡mt¤ì4(€€€Í•Ñ5•ÍÍ…•Ì¡mt¤ì4(€€€Í•ÑM•±•Ñ•‘¡…¹¹•±%¡¹Õ±°¤ì4(€€€Í•ÑÑ¥Ù•Y¥•Ü ‰‘…Í¡‰½…Éˆ¤ì4(€€€Í•Ñ]Í½¹¹•Ñ•¡™…±Í”¤ì4(€€€Í•Ñ9•áÕÍM•¹‘MÑ…Ñ”¡¹Õ±°¤ì4(€€€Á•¹‘¥¹9•áÕÍ5•ÍÍ…•ÍI•˜¹ÕÉÉ•¹Ð¹±•…È ¤ì4(€€€‘•±¥Ù•ÉåMÑ…ÑÕÍ•ÍI•˜¹ÕÉÉ•¹Ð¹±•…È ¤ì4(€€€É••¹Ñ•¹ÑI•Á±¥•ÍI•˜¹ÕÉÉ•¹Ð¹±•…È ¤ì4(€ô4(4(€¥˜€¡±½…‘¥¹œ¤ì4(€€€É•ÑÕÉ¸€ 4(€€€€€€ñµ…¥¸±…ÍÍ9…µ”ô‰…ÁÀµÍ¡•±°ˆø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰±½…‘¥¹œˆù1½…‘¥¹œ•¹ÑMå¹Œ¸¸¸ð½‘¥Øø4(€€€€€€ð½µ…¥¸ø4(€€€€¤ì4(€ô4(4(€É•ÑÕÉ¸€ 4(€€€€ñµ…¥¸±…ÍÍ9…µ”ô‰…ÁÀµÍ¡•±°ˆø4(€€€€€ì…ÕÍ•È€ü€ 4(€€€€€€€€ñÕÑ¡A…¹•°½¹ÕÑ õíÉ•™É•Í¡ô€¼ø4(€€€€€€¤€è€ 4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘…Í¡‰½…ÉµÍ¡•±°ˆø4(€€€€€€€€€€ñÁÁM¥‘•‰…È…Ñ¥Ù•Y¥•Üõí…Ñ¥Ù•Y¥•Ýô½¹¡…¹”õíÍ•ÑÑ¥Ù•Y¥•ÝôÕÍ•ÈõíÕÍ•ÉôÝÍ½¹¹•Ñ•õíÝÍ½¹¹•Ñ•‘ô½¹1½½ÕÐõì ¤€ôøÙ½¥±½½ÕÐ ¥ô€¼ø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…¥¸µÝ½É­ÍÁ…”ˆø4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰‘…Í¡‰½…Éˆ€ü€ 4(€€€€€€€€€€€€€€ðø4(€€€€€€€€€€€€€€€€ñA…•!•…‘•ÈÑ¥Ñ±”ô‰½µµ…¹•¹Ñ•ÈˆÍÕ‰Ñ¥Ñ±”ô‰I•…°µÑ¥µ”½Ù•ÉÙ¥•Ü½˜Ñ¡”•¹ÑMå¹ŒÉ•±…ä¸ˆ±¥Ù”õíÝÍ½¹¹•Ñ•‘ô€¼ø4(€€€€€€€€€€€€€€€€ñ…Í¡‰½…É‘Y¥•Ü…•¹ÑÌõí…•¹ÑÍô¡…¹¹•±ÌõíÍ¡…É•‘¡…¹¹•±Íôµ•ÍÍ…•Ìõíµ•ÍÍ…•ÍôÝÍ½¹¹•Ñ•õíÝÍ½¹¹•Ñ•‘ô€¼ø4(€€€€€€€€€€€€€€ð¼ø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰…•¹ÑÌˆ€ü€ 4(€€€€€€€€€€€€€€ðø4(€€€€€€€€€€€€€€€€ñA…•!•…‘•ÈÑ¥Ñ±”ô‰•¹ÑÌˆÍÕ‰Ñ¥Ñ±”ô‰ÕÑ¡½É¥é”…•¹ÑÌÑ¼½¹¹•Ð™É½´å½ÕÈ‘•Ù¥•Ì°…¹É•Ù½­”…•ÍÌ…Ð…¹äÑ¥µ”¸ˆ±¥Ù”õíÝÍ½¹¹•Ñ•‘ô€¼ø4(€€€€€€€€€€€€€€€€ñ½¹¹•Ñ•¹ÑA…¹•°…•¹ÑÌõí…•¹ÑÍô½¹™¥œõí½¹™¥ô½¹•¹ÑÍ¡…¹•õíÉ•±½…‘1¥ÍÑÍô€¼ø4(€€€€€€€€€€€€€€ð¼ø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰…•ÍÌˆ€ü€ 4(€€€€€€€€€€€€€€ðø4(€€€€€€€€€€€€€€€€ñA…•!•…‘•ÈÑ¥Ñ±”ô‰•ÍÌˆÍÕ‰Ñ¥Ñ±”ô‰•¹•É…Ñ”…¹É•Ù½­”µ•µ‰•È…•ÍÌ­•åÌ¸ˆ±¥Ù”õíÝÍ½¹¹•Ñ•‘ô€¼ø4(€€€€€€€€€€€€€€€€ñ•ÍÍA…¹•°…•ÍÍ-•åÌõí…•ÍÍ-•åÍô½¹•ÍÍ¡…¹•õíÉ•±½…‘1¥ÍÑÍô€¼ø4(€€€€€€€€€€€€€€ð¼ø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰¡…Ðˆ€ü€ 4(€€€€€€€€€€€€€€ðø4(€€€€€€€€€€€€€€€€ñA…•!•…‘•ÈÑ¥Ñ±”ô‰¡…ÐˆÍÕ‰Ñ¥Ñ±”ô‰½¹Ñ¥¹Õ”‘¥É•Ð½¹Ù•ÉÍ…Ñ¥½¹Ì½Èµ•ÍÍ…”Í¡…É•…•¹Ð¡…¹¹•±Ì¸ˆ±¥Ù”õíÝÍ½¹¹•Ñ•‘ô€¼ø4(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡…ÐµÝ½É­ÍÁ…”ˆø4(€€€€€€€€€€€€€€€€€€ñ¡…¹¹•±A…¹•°4(€€€€€€€€€€€€€€€€€€€¡…¹¹•±Ìõí¡…¹¹•±Íô4(€€€€€€€€€€€€€€€€€€€…•¹ÑÌõí…•¹ÑÍô4(€€€€€€€€€€€€€€€€€€€µ•µ‰•ÉÌõíµ•µ‰•ÉÌ¹™¥±Ñ•È ¡µ•µ‰•È¤€ôøµ•µ‰•È¹¥€„ôôÕÍ•È¹¥¥ô4(€€€€€€€€€€€€€€€€€€€Í•±•Ñ•‘%õíÍ•±•Ñ•‘¡…¹¹•±%‘ô4(€€€€€€€€€€€€€€€€€€€½¹M•±•ÐõíÍ•ÑM•±•Ñ•‘¡…¹¹•±%‘ô4(€€€€€€€€€€€€€€€€€€€½¹É•…Ñ•õíÉ•±½…‘1¥ÍÑÍô4(€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€ñ¡…ÑA…¹•°¡…¹¹•°õíÍ•±•Ñ•‘¡…¹¹•±ôÑ¥Ñ±”õíÍ•±•Ñ•‘¡…¹¹•±Q¥Ñ±•ôµ•ÍÍ…•Ìõíµ•ÍÍ…•Íô½¹M•¹õíÍ•¹‘5•ÍÍ…•ô€¼ø4(€€€€€€€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€€€€€€€ð¼ø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰É•±…åÌˆ€ü€ñI•±…åÍY¥•Ü…•¹ÑÌõí…•¹ÑÍô½¹•¹ÑÍ¡…¹•õíÉ•±½…‘1¥ÍÑÍô€¼ø€è¹Õ±±ô4(4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰ÁÉ½Ù¥‘•ÉÌˆ€ü€ 4(€€€€€€€€€€€€€€ðø4(€€€€€€€€€€€€€€€€ñA…•!•…‘•ÈÑ¥Ñ±”ô‰AÉ½Ù¥‘•ÉÌˆÍÕ‰Ñ¥Ñ±”ô‰MÑ½É”•¹ÉåÁÑ•114ÁÉ½Ù¥‘•ÈA$­•åÌ™½È™ÕÑÕÉ”…•¹Ð•á•ÕÑ¥½¸¸ˆ±¥Ù”õíÝÍ½¹¹•Ñ•‘ô€¼ø4(€€€€€€€€€€€€€€€€ñAÉ½Ù¥‘•ÉÍA…¹•°€¼ø4(€€€€€€€€€€€€€€ð¼ø4(€€€€€€€€€€€€¤€è¹Õ±±ô4(4(€€€€€€€€€€€í…Ñ¥Ù•Y¥•Ü€ôôô€‰¹•áÕÌˆ€ü€ñ9•áÕÍY¥•Ü±¥Ù”õíÝÍ½¹¹•Ñ•‘ôÉ•™É•Í¡M¥¹…°õí¹•áÕÍI•™É•Í¡ôÍ•¹‘MÑ…Ñ”õí¹•áÕÍM•¹‘MÑ…Ñ•ô½¹M•¹‘Q½•¹ÐõíÍ•¹‘9•áÕÍ5•ÍÍ…•ô€¼ø€è¹Õ±±ô4(€€€€€€€€€€ð½‘¥Øø4(€€€€€€€€ð½‘¥Øø4(€€€€€€¥ô4(€€€€ð½µ…¥¸ø4(€€¤ì4)ô4