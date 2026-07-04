import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { clearLoginSession, createLoginSession, currentUser, hashPassword, requireUser, verifyPassword } from "../auth.js";
import { randomSecret, sha256 } from "../crypto.js";
import type { Store } from "../db/store.js";
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = registerSchema;

const createEnrollmentSchema = z.object({
  label: z.string().trim().min(1).max(80).optional()
});

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  inviteEmail: z.string().email().optional().or(z.literal(""))
});

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  replyToMessageId: z.string().optional().nullable()
});

async function userCanAccessChannel(store: Store, userId: string, channelId: string): Promise<boolean> {
  const channels = await store.listChannelsForUser(userId);
  return channels.some((channel) => channel.id === channelId);
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

  app.post("/api/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    if (await store.getUserByEmail(email)) {
      reply.code(409);
      return { error: "An account with that email already exists." };
    }
    const user = await store.createUser(email, await hashPassword(body.password));
    await createLoginSession(store, reply, user.id);
    return { user };
  });

  app.post("/api/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await store.getUserByEmail(normalizeEmail(body.email));
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      reply.code(401);
      return { error: "Invalid email or password." };
    }
    await createLoginSession(store, reply, user.id);
    return { user: { id: user.id, email: user.email, createdAt: user.createdAt } };
  });

  app.post("/api/logout", async (request, reply) => {
    await clearLoginSession(store, request, reply);
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

    if (body.inviteEmail) {
      const invitee = await store.getUserByEmail(normalizeEmail(body.inviteEmail));
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
      userName: user.email,
      content: body.content,
      replyToMessageId: body.replyToMessageId
    });
    return { message };
  });
}
