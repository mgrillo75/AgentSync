import crypto from "node:crypto";
import WebSocket from "ws";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3100";
const relayUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/relay";
const founderAccessKey = process.env.E2E_ACCESS_KEY;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hmacHex(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function makeUpgradeToken(gatewayId, secret) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const sig = hmacHex(`${gatewayId}:${exp}`, secret);
  return Buffer.from(`${gatewayId}:${exp}:${sig}`, "utf8").toString("base64url");
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  return value?.split(";")[0] ?? "";
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(body)}`);
  return { response, body };
}

async function enterAccessKey(token) {
  const { response, body } = await json("/api/access", {
    method: "POST",
    body: JSON.stringify({ token })
  });
  return { cookie: cookieFrom(response), user: body.user };
}

async function createAccessKey(cookie, name) {
  const { body } = await json("/api/access-keys", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name })
  });
  return body.token;
}

async function createEnrollment(cookie) {
  const { body } = await json("/api/enrollment-tokens", {
    method: "POST",
    headers: { Cookie: cookie },
    body: "{}"
  });
  return body.token;
}

async function enroll(token, gatewayId) {
  const { body } = await json("/relay/enroll", {
    method: "POST",
    headers: { Authorization: "Bearer local-e2e" },
    body: JSON.stringify({ enrollmentToken: token, gatewayId })
  });
  return body;
}

async function createPairing(cookie) {
  const { body } = await json("/api/agents/pair", {
    method: "POST",
    headers: { Cookie: cookie },
    body: "{}"
  });
  assert(body.gatewayId && body.secret && body.env, "pairing response missing credentials");
  return body;
}

class RelayClient {
  constructor(name, gatewayId, secret) {
    this.name = name;
    this.gatewayId = gatewayId;
    this.frames = [];
    this.waiters = [];
    this.buffer = "";
    this.ws = new WebSocket(relayUrl, {
      headers: { Authorization: `Bearer ${makeUpgradeToken(gatewayId, secret)}` }
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (data) => this.onMessage(data.toString("utf8")));
    this.send({ type: "hello", platform: "relay", botId: this.name });
    const descriptor = await this.waitFor((frame) => frame.type === "descriptor");
    assert(descriptor.descriptor.contract_version === 1, `${this.name} descriptor version mismatch`);
  }

  onMessage(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      this.frames.push(frame);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(frame)) {
          clearTimeout(waiter.timeout);
          this.waiters = this.waiters.filter((item) => item !== waiter);
          waiter.resolve(frame);
        }
      }
      if (frame.type === "inbound" && frame.bufferId) {
        this.send({ type: "inbound_ack", bufferId: frame.bufferId });
      }
    }
  }

  send(frame) {
    this.ws.send(`${JSON.stringify(frame)}\n`);
  }

  waitFor(predicate, ms = 5000) {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timeout: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`${this.name} timed out waiting for frame`));
        }, ms)
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    this.ws.close();
  }
}

const unique = Date.now();
assert(founderAccessKey, "Set E2E_ACCESS_KEY to a Founder/member key before running relay E2E");
const founder = await enterAccessKey(founderAccessKey);
const caToken = await createAccessKey(founder.cookie, `California ${unique}`);
const txToken = await createAccessKey(founder.cookie, `Texas ${unique}`);
const caMember = await enterAccessKey(caToken);
const txMember = await enterAccessKey(txToken);
const caCookie = caMember.cookie;
const txCookie = txMember.cookie;
const caPair = await createPairing(caCookie);
const txEnroll = await enroll(await createEnrollment(txCookie), `gw-tx-${unique}`);

const { body: channelBody } = await json("/api/channels", {
  method: "POST",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ name: "E2E Shared Channel", inviteUserId: txMember.user.id })
});
const channel = channelBody.channel;

const ca = new RelayClient("California", caPair.gatewayId, caPair.secret);
const tx = new RelayClient("Texas", txEnroll.gatewayId, txEnroll.secret);
await Promise.all([ca.open(), tx.open()]);

await json(`/api/channels/${channel.id}/messages`, {
  method: "POST",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ content: "Human hello to both agents" })
});

const caInbound = await ca.waitFor((frame) => frame.type === "inbound" && frame.event.text.includes("Human hello"));
const txInbound = await tx.waitFor((frame) => frame.type === "inbound" && frame.event.text.includes("Human hello"));
assert(caInbound.event.source.chat_id === channel.id, "CA inbound channel mismatch");
assert(txInbound.event.source.chat_id === channel.id, "TX inbound channel mismatch");

const requestId = crypto.randomUUID().replaceAll("-", "");
ca.send({
  type: "outbound",
  requestId,
  action: {
    op: "send",
    chat_id: channel.id,
    content: "California agent says hello to Texas",
    reply_to: caInbound.event.message_id
  }
});

const result = await ca.waitFor((frame) => frame.type === "outbound_result" && frame.requestId === requestId);
assert(result.result.success === true, "agent outbound send failed");
const peerFrame = await tx.waitFor((frame) => frame.type === "inbound" && frame.event.text.includes("California agent"));
assert(peerFrame.event.source.user_name.includes("Hermes"), "peer inbound author mismatch");

ca.close();
tx.close();

console.log("Relay E2E passed:", {
  channelId: channel.id,
  caGateway: caPair.gatewayId,
  txGateway: txEnroll.gatewayId
});
