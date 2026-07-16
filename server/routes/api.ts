import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { clearLoginSession, createLoginSession, currentUser, requireUser } from "../auth.js";
import { encryptSecret, randomSecret, sha256 } from "../crypto.js";
import type { Store } from "../db/store.js";
import type { RelayHub } from "../relay/relayHub.js";
import { getAgentSecret, provisionAgentForOwner } from "../services/agentProvisioning.js";
import type { BrowserHub } from "../services/browserHub.js";
import type { MessageRouter } from "../services/messageRouter.js";
import type { Agent, NexusLink, ProviderKey } from "../types.js";

function publicBaseUrl(request: FastifyRequest): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"]?.toString().split(",")[0] || "http";
  const host = request.headers["x-forwarded-host"]?.toString().split(",")[0] || request.headers.host || "localhost:3000";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function relayUrl(request: FastifyRequest): string {
  return `${publicBaseUrl(request).replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/relay`;
}

function accessKeyPreview(token: string): string {
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function providerLabel(provider: string): string {
  return (
    {
      openai: "OpenAI",
      anthropic: "Anthropic",
      google: "Google",
      xai: "xAI"
    }[provider] ?? provider
  );
}

function publicProviderKey(providerKey: ProviderKey): Omit<ProviderKey, "encryptedKey"> {
  const { encryptedKey: _encryptedKey, ...safe } = providerKey;
  return safe;
}

const accessSchema = z.object({
  token: z.string().trim().min(16)
});

const createAccessKeySchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const createEnrollmentSchema = z.object({
  label: z.string().trim().min(1).max(80).optional()
});

const authorizeAgentSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  systemLabel: z.string().trim().min(1).max(120),
  systemType: z.enum(["laptop", "desktop", "server", "other"]),
  agentKind: z.string().trim().min(1).max(80).optional()
});

const updateAgentSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    subtitleAlias: z.string().trim().max(120).nullable().optional()
  })
  .strict()
  .refine((value) => value.displayName !== undefined || value.subtitleAlias !== undefined, {
    message: "Provide a display name or subtitle alias."
  });

const providerSchema = z.enum(["openai", "anthropic", "google", "xai"]);

const createProviderKeySchema = z.object({
  provider: providerSchema,
  label: z.string().trim().min(1).max(80).optional(),
  key: z.string().trim().min(1).max(4096)
});

const agentToolsSchema = z.array(z.string().trim().min(1).max(64)).max(20);

const createLlmAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  provider: providerSchema,
  model: z.string().trim().min(1).max(120),
  role: z.enum(["coordinator", "worker"]),
  tools: agentToolsSchema.optional(),
  avatarSeed: z.string().trim().min(1).max(80).optional(),
  parentId: z.string().trim().min(1).optional().nullable()
});

const updateLlmAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    model: z.string().trim().min(1).max(120).optional(),
    role: z.enum(["coordinator", "worker"]).optional(),
    tools: agentToolsSchema.optional(),
    parentId: z.string().trim().min(1).optional().nullable(),
    x: z.number().finite().optional().nullable(),
    y: z.number().finite().optional().nullable()
  })
  .strict();

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  inviteUserId: z.string().optional().or(z.literal(""))
});

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  replyToMessageId: z.string().optional().nullable()
});

async function userCanAccessChannel(store: Store, userId: string, channelId: string): Promise<boolean> {
  const channels = await store.listChannelsForUser(userId);
  return channels.some((channel) => channel.id === channelId);
}

function publicAgent(agent: Agent): Omit<Agent, "secret" | "deliveryKey"> {
  const { secret: _secret, deliveryKey: _deliveryKey, ...safe } = agent;
  return safe;
}

function envBlock(url: string, gatewayId: string, secret: string): string {
  return [`GATEWAY_RELAY_URL=${url}`, `GATEWAY_RELAY_ID=${gatewayId}`, `GATEWAY_RELAY_SECRET=${secret}`].join("\n");
}

function shellExportBlock(url: string, gatewayId: string, secret: string): string {
  return [`export GATEWAY_RELAY_URL="${url}"`, `export GATEWAY_RELAY_ID="${gatewayId}"`, `export GATEWAY_RELAY_SECRET="${secret}"`].join("\n");
}

function scriptEnvLines(url: string, gatewayId: string, secret: string): string[] {
  return [`GATEWAY_RELAY_URL=${url}`, `GATEWAY_RELAY_ID=${gatewayId}`, `GATEWAY_RELAY_SECRET=${secret}`];
}

function macSetupScript(url: string, gatewayId: string, secret: string): string {
  const envLines = scriptEnvLines(url, gatewayId, secret);
  return `#!/bin/sh
set -u

echo "AgentSync Hermes Gateway setup"
echo "--------------------------------"

ENV_FILE="$HOME/.hermes/.env"
mkdir -p "$HOME/.hermes"
TMP_FILE="$(mktemp)"

if [ -f "$ENV_FILE" ]; then
  grep -v '^GATEWAY_RELAY_' "$ENV_FILE" > "$TMP_FILE" || true
fi

cat >> "$TMP_FILE" <<'AGENTSYNC_ENV'
${envLines.join("\n")}
AGENTSYNC_ENV

mv "$TMP_FILE" "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true
echo "Wrote AgentSync relay settings to $ENV_FILE"

if command -v hermes >/dev/null 2>&1; then
  HERMES_CMD="hermes"
elif [ -x "$HOME/.hermes/hermes-agent/venv/bin/hermes" ]; then
  HERMES_CMD="$HOME/.hermes/hermes-agent/venv/bin/hermes"
elif [ -x "$HOME/.hermes/hermes-agent/venv/bin/python" ]; then
  HERMES_CMD="$HOME/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main"
else
  HERMES_CMD="python3 -m hermes_cli.main"
fi

echo "Using Hermes command: $HERMES_CMD"

set +e
$HERMES_CMD gateway install
INSTALL_CODE=$?
$HERMES_CMD gateway start
START_CODE=$?
$HERMES_CMD gateway status
STATUS_CODE=$?
set -e

if [ "$INSTALL_CODE" -eq 0 ] && [ "$START_CODE" -eq 0 ]; then
  echo ""
  echo "SUCCESS: AgentSync relay is installed and starting."
  echo "You can close this window. AgentSync should show this agent as connected shortly."
  exit 0
fi

echo ""
echo "SETUP NEEDS ATTENTION"
echo "install exit code: $INSTALL_CODE"
echo "start exit code: $START_CODE"
echo "status exit code: $STATUS_CODE"
echo "If this keeps failing, send this window text to your AgentSync admin."
exit 1
`;
}

function windowsSetupScript(url: string, gatewayId: string, secret: string): string {
  const envLines = scriptEnvLines(url, gatewayId, secret)
    .map((line) => `"${line.replace(/"/g, '`"')}"`)
    .join(", ");
  const ps = `$ErrorActionPreference = "Continue"
Write-Host "AgentSync Hermes Gateway setup"
Write-Host "--------------------------------"

$dir = Join-Path $env:USERPROFILE ".hermes"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$path = Join-Path $dir ".env"
$existing = if (Test-Path $path) { Get-Content $path } else { @() }
$filtered = $existing | Where-Object { $_ -notmatch '^GATEWAY_RELAY_' }
$relay = @(${envLines})
($filtered + $relay) | Set-Content -Path $path -Encoding utf8
Write-Host "Wrote AgentSync relay settings to $path"

$hermes = Get-Command hermes -ErrorAction SilentlyContinue
if ($hermes) {
  $cmd = "hermes"
} else {
  $venvHermes = Join-Path $env:LOCALAPPDATA "hermes\\hermes-agent\\venv\\Scripts\\hermes.exe"
  if (Test-Path $venvHermes) { $cmd = $venvHermes } else { $cmd = "hermes" }
}

& $cmd gateway install
$installCode = $LASTEXITCODE
& $cmd gateway start
$startCode = $LASTEXITCODE
& $cmd gateway status
$statusCode = $LASTEXITCODE

if ($installCode -eq 0 -and $startCode -eq 0) {
  Write-Host ""
  Write-Host "SUCCESS: AgentSync relay is installed and starting."
  Write-Host "You can close this window. AgentSync should show this agent as connected shortly."
  exit 0
}

Write-Host ""
Write-Host "SETUP NEEDS ATTENTION"
Write-Host "install exit code: $installCode"
Write-Host "start exit code: $startCode"
Write-Host "status exit code: $statusCode"
Write-Host "If this keeps failing, send this window text to your AgentSync admin."
exit 1
`;
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  return `@echo off
powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}
pause
`;
}

export async function registerApiRoutes(
  app: FastifyInstance,
  store: Store,
  router: MessageRouter,
  relayHub: RelayHub,
  browserHub: BrowserHub
): Promise<void> {
  app.get("/api/health", async () => ({
    ok: true,
    store: store.kind,
    time: new Date().toISOString()
  }));

  app.get("/api/config", async (request) => ({
    relayUrl: relayUrl(request),
    baseUrl: publicBaseUrl(request),
    persistence: store.kind
  }));

  app.get("/api/me", async (request) => {
    const user = await currentUser(store, request);
    if (!user) return { user: null, agents: [], channels: [] };
    const [agents, channels] = await Promise.all([store.listAgentsForUser(user.id), store.listChannelsForUser(user.id)]);
    return {
      user,
      agents: agents.map(({ secret: _secret, deliveryKey: _deliveryKey, ...safe }) => safe),
      channels
    };
  });

  app.post("/api/access", async (request, reply) => {
    const body = accessSchema.parse(request.body);
    const user = await store.getUserByAccessKeyHash(sha256(body.token));
    if (!user) {
      reply.code(401);
      return { error: "Invalid or revoked access key." };
    }
    await createLoginSession(store, reply, user.id);
    return { user };
  });

  app.post("/api/logout", async (request, reply) => {
    await clearLoginSession(store, request, reply);
    return { ok: true };
  });

  app.get("/api/members", async (request) => {
    await requireUser(store, request);
    return { members: await store.listUsers() };
  });

  app.get("/api/access-keys", async (request) => {
    await requireUser(store, request);
    const accessKeys = await store.listAccessKeys();
    const agentsByUser = new Map<string, Array<Omit<Agent, "secret" | "deliveryKey">>>();
    await Promise.all(
      [...new Set(accessKeys.map((accessKey) => accessKey.userId))].map(async (userId) => {
        const agents = (await store.listAgentsForUser(userId))
          .filter((agent) => !agent.revokedAt)
          .map(publicAgent);
        agentsByUser.set(userId, agents);
      })
    );
    return {
      accessKeys: accessKeys.map((accessKey) => ({ ...accessKey, agents: agentsByUser.get(accessKey.userId) ?? [] }))
    };
  });

  app.post("/api/access-keys", async (request) => {
    await requireUser(store, request);
    const body = createAccessKeySchema.parse(request.body);
    const token = `ak_${randomSecret(32)}`;
    const result = await store.createUserWithKey({
      name: body.name,
      tokenHash: sha256(token),
      tokenPreview: accessKeyPreview(token),
      label: body.name
    });
    return { ...result, token };
  });

  app.delete("/api/access-keys/:accessKeyId", async (request, reply) => {
    await requireUser(store, request);
    const { accessKeyId } = request.params as { accessKeyId: string };
    const accessKey = await store.revokeAccessKey(accessKeyId);
    if (!accessKey) {
      reply.code(404);
      return { error: "Access key not found." };
    }
    return { accessKey };
  });

  app.get("/api/provider-keys", async (request) => {
    const user = await requireUser(store, request);
    const providerKeys = await store.listProviderKeys(user.id);
    return { providerKeys: providerKeys.map(publicProviderKey) };
  });

  app.post("/api/provider-keys", async (request) => {
    const user = await requireUser(store, request);
    const body = createProviderKeySchema.parse(request.body);
    const providerKey = await store.upsertProviderKey({
      ownerUserId: user.id,
      provider: body.provider,
      label: body.label || providerLabel(body.provider),
      encryptedKey: encryptSecret(body.key),
      keyPreview: accessKeyPreview(body.key)
    });
    return { providerKey: publicProviderKey(providerKey) };
  });

  app.delete("/api/provider-keys/:providerKeyId", async (request, reply) => {
    const user = await requireUser(store, request);
    const { providerKeyId } = request.params as { providerKeyId: string };
    const deleted = await store.deleteProviderKey(user.id, providerKeyId);
    if (!deleted) {
      reply.code(404);
      return { error: "Provider key not found." };
    }
    return { ok: true };
  });

  app.get("/api/llm-agents", async (request) => {
    const user = await requireUser(store, request);
    return { llmAgents: await store.listLlmAgents(user.id) };
  });

  app.post("/api/llm-agents", async (request, reply) => {
    const user = await requireUser(store, request);
    const body = createLlmAgentSchema.parse(request.body);
    const providerKeys = await store.listProviderKeys(user.id);
    if (!providerKeys.some((providerKey) => providerKey.provider === body.provider)) {
      reply.code(400);
      return { error: `Add a ${providerLabel(body.provider)} API key in Providers first.` };
    }

    if (body.parentId) {
      const parent = await store.getLlmAgentById(body.parentId);
      if (!parent || parent.ownerUserId !== user.id || parent.role !== "coordinator") {
        reply.code(400);
        return { error: "Reports to must be one of your coordinator agents." };
      }
    }

    const llmAgent = await store.createLlmAgent({
      ownerUserId: user.id,
      name: body.name,
      description: body.description || null,
      provider: body.provider,
      model: body.model,
      role: body.role,
      tools: body.tools ?? [],
      avatarSeed: body.avatarSeed || randomSecret(8),
      parentId: body.parentId ?? null
    });
    return { llmAgent };
  });

  app.patch("/api/llm-agents/:llmAgentId", async (request, reply) => {
    const user = await requireUser(store, request);
    const { llmAgentId } = request.params as { llmAgentId: string };
    const existing = await store.getLlmAgentById(llmAgentId);
    if (!existing || existing.ownerUserId !== user.id) {
      reply.code(404);
      return { error: "LLM agent not found." };
    }

    const body = updateLlmAgentSchema.parse(request.body);
    if (body.parentId === llmAgentId) {
      reply.code(400);
      return { error: "An agent cannot report to itself." };
    }
    if (body.parentId) {
      const parent = await store.getLlmAgentById(body.parentId);
      if (!parent || parent.ownerUserId !== user.id) {
        reply.code(404);
        return { error: "LLM agent not found." };
      }
      if (parent.role !== "coordinator") {
        reply.code(400);
        return { error: "Reports to must be one of your coordinator agents." };
      }
    }

    const llmAgent = await store.updateLlmAgent(llmAgentId, {
      ...body,
      description: body.description === "" ? null : body.description
    });
    if (!llmAgent) {
      reply.code(404);
      return { error: "LLM agent not found." };
    }
    return { llmAgent };
  });

  app.delete("/api/llm-agents/:llmAgentId", async (request, reply) => {
    const user = await requireUser(store, request);
    const { llmAgentId } = request.params as { llmAgentId: string };
    const existing = await store.getLlmAgentById(llmAgentId);
    if (!existing || existing.ownerUserId !== user.id) {
      reply.code(404);
      return { error: "LLM agent not found." };
    }
    await store.deleteLlmAgent(llmAgentId);
    return { ok: true };
  });

  app.post("/api/enrollment-tokens", async (request) => {
    const user = await requireUser(store, request);
    createEnrollmentSchema.parse(request.body ?? {});
    const token = `as_${randomSecret(24)}`;
    const enrollment = await store.createEnrollmentToken(
      user.id,
      sha256(token),
      `${token.slice(0, 8)}...${token.slice(-4)}`,
      new Date(Date.now() + 60 * 60 * 1000)
    );
    const url = relayUrl(request);
    return {
      enrollment,
      token,
      relayUrl: url,
      command: `hermes gateway enroll --connector-url ${url} --token ${token}`,
      installCommand: "hermes gateway install",
      agentPrompt: `Set up my AgentSync connection. Run: hermes gateway enroll --connector-url ${url} --token ${token} Then run: hermes gateway install Confirm the gateway is running when finished.`
    };
  });

  app.post("/api/agents/authorize", async (request, reply) => {
    const user = await requireUser(store, request);
    const body = authorizeAgentSchema.parse(request.body);
    const gatewayId = `gw-agentsync-${randomSecret(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase()}`;
    let provisioned;
    try {
      provisioned = await provisionAgentForOwner(store, {
        ownerUserId: user.id,
        gatewayId,
        displayName: body.displayName,
        systemLabel: body.systemLabel,
        systemType: body.systemType,
        agentKind: body.agentKind ?? null
      });
    } catch (error) {
      if (error instanceof Error && error.message === "gateway id belongs to a revoked agent") {
        reply.code(409);
        return { error: error.message };
      }
      throw error;
    }
    const { agent, secret, deliveryKey } = provisioned;
    const url = relayUrl(request);
    const env = envBlock(url, gatewayId, secret);
    const macPath = "~/.hermes/.env";
    const winPath = "%USERPROFILE%\\.hermes\\.env";
    const macCommands = `mkdir -p ~/.hermes\npython - <<'PY'\nfrom pathlib import Path\npath = Path.home() / ".hermes" / ".env"\nexisting = path.read_text() if path.exists() else ""\nlines = [line for line in existing.splitlines() if not line.startswith("GATEWAY_RELAY_")]\nlines.extend(${JSON.stringify(env.split("\n"))})\npath.write_text("\\n".join(lines) + "\\n")\nPY\nhermes gateway install\nhermes gateway start`;
    const windowsCommands = `$dir = Join-Path $env:USERPROFILE ".hermes"\nNew-Item -ItemType Directory -Force -Path $dir | Out-Null\n$path = Join-Path $dir ".env"\n$existing = if (Test-Path $path) { Get-Content $path } else { @() }\n$filtered = $existing | Where-Object { $_ -notmatch '^GATEWAY_RELAY_' }\n$relay = @(${env.split("\n").map((line) => `"${line}"`).join(", ")})\n($filtered + $relay) | Set-Content -Path $path -Encoding utf8\nhermes gateway install\nhermes gateway start`;
    return {
      agent: (({ secret: _secret, deliveryKey: _deliveryKey, ...safe }) => safe)(agent),
      relayUrl: url,
      gatewayId,
      secret,
      deliveryKey,
      env,
      shellExports: shellExportBlock(url, gatewayId, secret),
      macPath,
      winPath,
      macCommands,
      windowsCommands,
      installCommand: "hermes gateway install",
      restartCommand: "hermes gateway start",
      agentPrompt: `Set up my AgentSync connection without using Nous Portal.\n\nUpdate my Hermes environment file by replacing any existing GATEWAY_RELAY_* lines with:\n\n${env}\n\nThen run:\nhermes gateway install\nhermes gateway start\n\nIf start is not available, start the gateway with: hermes gateway\n\nConfirm AgentSync shows this agent as connected.`
    };
  });

  app.post("/api/agents/:agentId/revoke", async (request, reply) => {
    const user = await requireUser(store, request);
    const { agentId } = request.params as { agentId: string };
    const agent = await store.revokeAgent(user.id, agentId);
    if (!agent) {
      reply.code(404);
      return { error: "Agent not found." };
    }

    relayHub.disconnectAgent(agent.id);
    browserHub.sendToUser(user.id, {
      type: "agent_revoked",
      agentId: agent.id,
      gatewayId: agent.gatewayId
    });
    return { agent: (({ secret: _secret, deliveryKey: _deliveryKey, ...safe }) => safe)(agent) };
  });

  app.patch("/api/agents/:agentId", async (request, reply) => {
    const user = await requireUser(store, request);
    const { agentId } = request.params as { agentId: string };
    const body = updateAgentSchema.parse(request.body);
    const agent = await store.updateAgent(user.id, agentId, {
      ...body,
      ...(body.subtitleAlias !== undefined ? { subtitleAlias: body.subtitleAlias || null } : {})
    });
    if (!agent) {
      reply.code(404);
      return { error: "Agent not found." };
    }
    return { agent: publicAgent(agent) };
  });

  app.get("/api/agents/:agentId/setup-script", async (request, reply) => {
    const user = await requireUser(store, request);
    const { agentId } = request.params as { agentId: string };
    const { os } = request.query as { os?: string };
    const agent = await store.getAgentById(agentId);
    if (!agent || agent.ownerUserId !== user.id || agent.revokedAt) {
      reply.code(404);
      return { error: "Agent not found." };
    }

    const url = relayUrl(request);
    if (os === "windows") {
      const script = windowsSetupScript(url, agent.gatewayId, getAgentSecret(agent));
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", 'attachment; filename="AgentSync-Setup.bat"');
      return script;
    }

    if (os === "mac" || !os) {
      const script = macSetupScript(url, agent.gatewayId, getAgentSecret(agent));
      reply
        .header("Content-Type", "application/x-sh; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="AgentSync-Setup.command"');
      return script;
    }

    reply.code(400);
    return { error: "Unsupported setup script OS. Use os=mac or os=windows." };
  });

  app.get("/api/agents", async (request) => {
    const user = await requireUser(store, request);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await store.purgeStaleAgents(user.id, cutoff);
    const agents = (await store.listAgentsForUser(user.id)).filter(
      (agent) => Boolean(agent.connectedAt) || Boolean(agent.lastSeenAt && Date.parse(agent.lastSeenAt) >= cutoff.getTime())
    );
    return { agents: agents.map(publicAgent) };
  });

  app.get("/api/nexus/graph", async (request) => {
    const user = await requireUser(store, request);
    const [ownedAgents, channels] = await Promise.all([
      store.listAgentsForUser(user.id),
      store.listChannelsForUser(user.id)
    ]);
    const agents = ownedAgents.filter((agent) => Boolean(agent.connectedAt) && !agent.revokedAt);
    const participants = new Map<string, { kind: "user" | "agent"; id: string }>();
    participants.set(`user:${user.id}`, { kind: "user", id: user.id });
    for (const agent of agents) participants.set(`agent:${agent.id}`, { kind: "agent", id: agent.id });

    const linkMap = new Map<string, NexusLink>();
    for (const channel of channels) {
      const messages = (await store.listMessages(channel.id, 200)).filter(
        (message) => message.authorKind !== "system" && participants.has(`${message.authorKind}:${message.authorId}`)
      );
      for (let index = 1; index < messages.length; index += 1) {
        const previous = messages[index - 1];
        const current = messages[index];
        if (previous.authorKind === "system" || current.authorKind === "system") continue;
        const previousKey = `${previous.authorKind}:${previous.authorId}`;
        const currentKey = `${current.authorKind}:${current.authorId}`;
        if (previousKey === currentKey) continue;
        const [fromKey, toKey] = [previousKey, currentKey].sort();
        const key = `${fromKey}|${toKey}`;
        const from = participants.get(fromKey);
        const to = participants.get(toKey);
        if (!from || !to) continue;
        const existing = linkMap.get(key);
        linkMap.set(key, {
          fromKind: from.kind,
          fromId: from.id,
          toKind: to.kind,
          toId: to.id,
          lastAt: existing && existing.lastAt > current.createdAt ? existing.lastAt : current.createdAt,
          count: (existing?.count ?? 0) + 1
        });
      }
    }

    return { member: user, agents: agents.map(publicAgent), links: [...linkMap.values()] };
  });

  app.get("/api/channels", async (request) => {
    const user = await requireUser(store, request);
    return { channels: await store.listChannelsForUser(user.id) };
  });

  app.post("/api/channels", async (request) => {
    const user = await requireUser(store, request);
    const body = createChannelSchema.parse(request.body);
    const channel = await store.createChannel({ name: body.name, createdBy: user.id });
    await store.addChannelMember(channel.id, "user", user.id);

    for (const agent of await store.listAgentsForUser(user.id)) {
      await store.addChannelMember(channel.id, "agent", agent.id);
    }

    if (body.inviteUserId) {
      const invitee = await store.getUserById(body.inviteUserId);
      if (invitee) {
        await store.addChannelMember(channel.id, "user", invitee.id);
        for (const agent of await store.listAgentsForUser(invitee.id)) {
          await store.addChannelMember(channel.id, "agent", agent.id);
        }
      }
    }

    return { channel: { ...channel, members: await store.getChannelMembers(channel.id) } };
  });

  app.get("/api/channels/:channelId/messages", async (request, reply) => {
    const user = await requireUser(store, request);
    const { channelId } = request.params as { channelId: string };
    if (!(await userCanAccessChannel(store, user.id, channelId))) {
      reply.code(404);
      return { error: "Channel not found." };
    }
    return { messages: await store.listMessages(channelId, 200) };
  });

  app.post("/api/channels/:channelId/messages", async (request, reply) => {
    const user = await requireUser(store, request);
    const { channelId } = request.params as { channelId: string };
    if (!(await userCanAccessChannel(store, user.id, channelId))) {
      reply.code(404);
      return { error: "Channel not found." };
    }
    const body = createMessageSchema.parse(request.body);
    const message = await router.routeHumanMessage({
      channelId,
      userId: user.id,
      userName: user.name,
      content: body.content,
      replyToMessageId: body.replyToMessageId
    });
    return { message };
  });
}
