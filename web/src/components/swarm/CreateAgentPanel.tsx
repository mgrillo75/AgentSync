import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LlmAgent, ProviderKey } from "../../types";
import { PROVIDERS, providerDefaultModel, providerLabel } from "../../lib/providers";
import { AgentAvatar } from "./AgentAvatar";

function randomSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTools(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function CreateAgentPanel({
  agents,
  providerKeys,
  onClose,
  onCreate,
  onGoToProviders
}: {
  agents: LlmAgent[];
  providerKeys: ProviderKey[];
  onClose: () => void;
  onCreate: (input: {
    name: string;
    description: string | null;
    provider: string;
    model: string;
    role: "coordinator" | "worker";
    tools: string[];
    avatarSeed: string;
    parentId: string | null;
  }) => Promise<void>;
  onGoToProviders: () => void;
}) {
  const keyedProviders = useMemo(() => {
    const ids = new Set(providerKeys.map((providerKey) => providerKey.provider));
    return PROVIDERS.filter((provider) => ids.has(provider.id));
  }, [providerKeys]);
  const coordinators = agents.filter((agent) => agent.role === "coordinator");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<string>(keyedProviders[0]?.id ?? "");
  const [model, setModel] = useState(provider ? providerDefaultModel(provider) : "");
  const [role, setRole] = useState<"coordinator" | "worker">("worker");
  const [parentId, setParentId] = useState("");
  const [tools, setTools] = useState("");
  const [avatarSeed, setAvatarSeed] = useState(randomSeed);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (provider || keyedProviders.length === 0) return;
    setProvider(keyedProviders[0].id);
    setModel(providerDefaultModel(keyedProviders[0].id));
  }, [keyedProviders, provider]);

  const selectedProvider = PROVIDERS.find((item) => item.id === provider);
  const hasKeys = keyedProviders.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!hasKeys || !name.trim() || !provider || !model.trim()) return;
    setError("");
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || null,
        provider,
        model: model.trim(),
        role,
        tools: parseTools(tools),
        avatarSeed,
        parentId: parentId || null
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="swarm-modal-scrim" role="presentation" onMouseDown={onClose}>
      <section className="swarm-modal" role="dialog" aria-modal="true" aria-label="Create agent" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Swarm</p>
            <h2>Create Agent</h2>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {!hasKeys ? (
          <div className="stack">
            <p className="warning">Add a provider API key before creating LLM agents.</p>
            <button type="button" onClick={onGoToProviders}>
              Go to Providers
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <div className="swarm-avatar-row">
              <AgentAvatar seed={avatarSeed} name={name || "Agent"} />
              <button type="button" className="secondary" onClick={() => setAvatarSeed(randomSeed())}>
                Randomize Seed
              </button>
            </div>

            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Research Coordinator" required />
            </label>

            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Coordinates research tasks and delegates summaries."
              />
            </label>

            <label>
              Provider
              <select
                value={provider}
                onChange={(event) => {
                  const nextProvider = event.target.value;
                  setProvider(nextProvider);
                  setModel(providerDefaultModel(nextProvider));
                }}
              >
                {keyedProviders.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Model
              <input list="swarm-models" value={model} onChange={(event) => setModel(event.target.value)} required />
              <datalist id="swarm-models">
                {(selectedProvider?.models ?? []).map((item) => (
                  <option value={item} key={item} />
                ))}
              </datalist>
            </label>

            <label>
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as "coordinator" | "worker")}>
                <option value="worker">Worker</option>
                <option value="coordinator">Coordinator</option>
              </select>
            </label>

            {coordinators.length > 0 ? (
              <label>
                Reports to
                <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">No coordinator</option>
                  {coordinators.map((agent) => (
                    <option value={agent.id} key={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label>
              Tools
              <input value={tools} onChange={(event) => setTools(event.target.value)} placeholder="search, browser, files" />
            </label>

            {error ? <p className="error">{error}</p> : null}

            <button type="submit" disabled={saving}>
              {saving ? "Creating..." : `Create ${providerLabel(provider)} Agent`}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
