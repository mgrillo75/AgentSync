import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { clearLoginSession, createLoginSession, currentUser, requireUser } from "../auth.js";
import { randomSecret, sha256 } from "../crypto.js";
import type { Store } from "../db/store.js";
import { provisionAgentForOwner } from "../services/agentProvisioning.js";
import type { MessageRouter } from "../services/messageRouter.js";

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

const accessSchema = z.object({
  token: z.string().trim().min(16)
});

const createAccessKeySchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const createEnrollmentSchema = z.object({
  label: z.string().trim().min(1).max(80).optional()
});

const createPairingSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional()
});

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

function envBlock(url: string, gatewayId: string, secret: string): string {
  return [`GATEWAY_RELAY_URL=${url}`, `GATEWAY_RELAY_ID=${gatewayId}`, `GATEWAY_RELAY_SECRET=${secret}`].join("\n");
}

function shellExportBlock(url: string, gatewayId: string, secret: string): string {
  return [`export GATEWAY_RELAY_URL="${url}"`, `export GATEWAY_RELAY_ID="${gatewayId}"`, `export GATEWAY_RELAY_SECRET="${secret}"`].join("\n");
}

export async function registerApiRoutes(app: FastifyInstance, store: Store, router: MessageRouter): Promise<void> {
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
    return { accessKeys: await store.listAccessKeys() };
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

  app.post("/api/agents/pair", async (request) => {
    const user = await requireUser(store, request);
    const body = createPairingSchema.parse(request.body ?? {});
    const gatewayId = `gw-agentsync-${randomSecret(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase()}`;
    const { agent, secret, deliveryKey } = await provisionAgentForOwner(store, {
      ownerUserId: user.id,
      gatewayId,
      displayName: body.displayName || `Hermes ${user.name}`
    });
    const url = relayUrl(request);
    const env = envBlock(url, gatewayId, secret);
    const macPath = "~/.hermes/.env";
    const winPath = "%USERPROFILE%\\.hermes\\.env";
    const macCommands = `mkdir -p ~/.hermes\npython - <<'PY'\nfrom pathlib import Path\npath = Path.home() / ".hermes" / ".env"\nexisting = path.read_text() if path.exists() else ""\nlines = [line for line in existing.splitlines() if not line.startswith("GATEWAY_RELAY_")]\nlines.extend(${JSON.stringify(env.split("\n"))})\npath.write_text("\\n".join(lines) + "\\n")\nPY\nhermes gateway install\nhermes gateway restart`;
    const windowsCommands = `$dir = Join-Path $env:USERPROFILE ".hermes"\nNew-Item -ItemType Directory -Force -Path $dir | Out-Null\n$path = Join-Path $dir ".env"\n$existing = if (Test-Path $path) { Get-Content $path } else { @() }\n$filtered = $existing | Where-Object { $_ -notmatch '^GATEWAY_RELAY_' }\n$relay = @(${env.split("\n").map((line) => `"${line}"`).join(", ")})\n($filtered + $relay) | Set-Content -Path $path -Encoding utf8\nhermes gateway install\nhermes gateway restart`;
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
      restartCommand: "hermes gateway restart",
      agentPrompt: `Set up my AgentSync connection without using Nous Portal.\n\nUpdate my Hermes environment file by replacing any existing GATEWAY_RELAY_* lines with:\n\n${env}\n\nThen run:\nhermes gateway install\nhermes gateway restart\n\nIf restart is not available, start the gateway with: hermes gateway\n\nConfirm AgentSync shows this agent as connected.`
    };
  });

  app.get("/api/agents", async (request) => {
    const user = await requireUser(store, request);
    const agents = await store.listAgentsForUser(user.id);
    return { agents: agents.map(({ secret: _secret, deliveryKey: _deliveryKey, ...safe }) => safe) };
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
