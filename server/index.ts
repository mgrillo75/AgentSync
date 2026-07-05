import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { randomSecret, sha256 } from "./crypto.js";
import { createStore } from "./db/store.js";
import { RelayHub } from "./relay/relayHub.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerRelayRoutes } from "./routes/relay.js";
import { BrowserHub } from "./services/browserHub.js";
import { MessageRouter } from "./services/messageRouter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");

const app = Fastify({
  logger: true,
  trustProxy: true
});

const store = createStore();
await store.init();

if ((await store.listUsers()).length === 0) {
  const token = `ak_${randomSecret(32)}`;
  await store.createUserWithKey({
    name: "Founder",
    tokenHash: sha256(token),
    tokenPreview: `${token.slice(0, 8)}...${token.slice(-4)}`,
    label: "Founder"
  });
  app.log.warn({ accessKey: token }, "Created Founder access key. It is shown once; copy it now.");
}

if (store.kind === "memory") {
  app.log.warn("DATABASE_URL is not set; using in-memory storage. Attach Heroku Postgres before production use.");
}

await app.register(cookie, {
  secret: process.env.COOKIE_SECRET || process.env.APP_SECRET || "dev-cookie-secret-change-me"
});

const browserHub = new BrowserHub(store);
const relayHub = new RelayHub(store, browserHub);
const messageRouter = new MessageRouter(store, browserHub, relayHub);
relayHub.setRouter(messageRouter);

await registerRelayRoutes(app, relayHub);
await registerApiRoutes(app, store, messageRouter);

await app.register(fastifyStatic, {
  root: webRoot,
  prefix: "/",
  wildcard: false
});

app.setNotFoundHandler(async (_request, reply) => {
  return reply.sendFile("index.html");
});

const browserWss = new WebSocketServer({ noServer: true });
browserWss.on("connection", (ws, request) => {
  void browserHub.authenticate(request).then((userId) => {
    if (!userId) {
      ws.close(4401, "unauthorized");
      return;
    }
    browserHub.addClient(userId, ws);
    ws.send(JSON.stringify({ type: "system", message: "browser connected" }));
  });
});

app.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/relay") {
    void relayHub.handleUpgrade(request, socket, head);
    return;
  }
  if (url.pathname === "/browser") {
    browserWss.handleUpgrade(request, socket, head, (ws) => {
      browserWss.emit("connection", ws, request);
    });
    return;
  }
  socket.destroy();
});

setInterval(() => {
  for (const wss of [relayHub.wss, browserWss]) {
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }
}, 30_000).unref();

const shutdown = async () => {
  app.log.info("shutting down");
  await app.close();
  await store.close();
};

process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";
await app.listen({ port, host });
