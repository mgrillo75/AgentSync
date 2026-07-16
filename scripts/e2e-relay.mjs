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
  return makeUpgradeTokenAtExp(gatewayId, secret, exp);
}

function makeUpgradeTokenAtExp(gatewayId, secret, exp) {
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

async function createAuthorization(cookie) {
  const { body } = await json("/api/agents/authorize", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({
      displayName: "California E2E Agent",
      systemLabel: "e2e-runner",
      systemType: "server"
    })
  });
  assert(body.gatewayId && body.secret && body.env, "authorization response missing credentials");
  return body;
}

async function expectRelayTokenRejected(token) {
  const ws = new WebSocket(relayUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("relay token was not rejected")), 5000);
    ws.once("open", () => {
      clearTimeout(timeout);
      ws.close();
      reject(new Error("rejected relay token unexpectedly connected"));
    });
    ws.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      resolve(response.statusCode);
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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

  waitForClose(ms = 5000) {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve({ code: this.closeCode, reason: this.closeReason });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${this.name} timed out waiting for socket close`)), ms);
      this.ws.once("close", (code, reason) => {
        clearTimeout(timeout);
        this.closeCode = code;
        this.closeReason = reason.toString();
        resolve({ code, reason: this.closeReason });
      });
    });
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
const caAuthorization = await createAuthorization(caCookie);
const txEnroll = await enroll(await createEnrollment(txCookie), `gw-tx-${unique}`);

const { body: labelBody } = await json(`/api/agents/${caAuthorization.agent.id}`, {
  method: "PATCH",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ displayName: "California Nexus Agent", subtitleAlias: "West relay" })
});
assert(labelBody.agent.displayName === "California Nexus Agent", "agent display name was not updated");
assert(labelBody.agent.subtitleAlias === "West relay", "agent subtitle alias was not updated");
assert(labelBody.agent.gatewayId === caAuthorization.gatewayId, "agent gateway ID changed during label update");

const { body: accessBody } = await json("/api/access-keys", { headers: { Cookie: founder.cookie } });
const caAccessKey = accessBody.accessKeys.find((accessKey) => accessKey.userId === caMember.user.id);
assert(caAccessKey?.agents.some((agent) => agent.id === caAuthorization.agent.id), "Access ownership omitted agent");

const setupResponse = await fetch(`${baseUrl}/api/agents/${caAuthorization.agent.id}/setup-script?os=mac`, {
  headers: { Cookie: caCookie }
});
const setupScript = await setupResponse.text();
assert(setupResponse.status === 200, `setup script returned ${setupResponse.status}`);
assert(setupScript.includes(caAuthorization.secret), "setup script did not contain the plaintext agent secret");

const neverExpiresStatus = await expectRelayTokenRejected(
  makeUpgradeTokenAtExp(caAuthorization.gatewayId, caAuthorization.secret, 0)
);
assert(neverExpiresStatus === 401, `exp=0 token returned ${neverExpiresStatus}, expected 401`);

const { body: channelBody } = await json("/api/channels", {
  method: "POST",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ name: "E2E Shared Channel", inviteUserId: txMember.user.id })
});
const channel = channelBody.channel;

const ca = new RelayClient("California", caAuthorization.gatewayId, caAuthorization.secret);
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
assert(peerFrame.event.source.user_name === "California Nexus Agent", "peer inbound author mismatch");

const { body: nexusBody } = await json("/api/nexus/graph", { headers: { Cookie: caCookie } });
assert(nexusBody.member.id === caMember.user.id, "Nexus member mismatch");
assert(nexusBody.agents.some((agent) => agent.id === caAuthorization.agent.id), "Nexus omitted connected agent");
assert(nexusBody.links.some((link) =>
  [link.fromId, link.toId].includes(caMember.user.id) && [link.fromId, link.toId].includes(caAuthorization.agent.id)
), "Nexus omitted member-agent communication link");

const closePromise = ca.waitForClose();
const { body: revokeBody } = await json(`/api/agents/${caAuthorization.agent.id}/revoke`, {
  method: "POST",
  headers: { Cookie: caCookie },
  body: "{}"
});
assert(revokeBody.agent.revokedAt, "revocation response missing revokedAt");
const revokedClose = await closePromise;
assert(revokedClose.code === 4403, `revoked socket closed with ${revokedClose.code}, expected 4403`);

const reconnectStatus = await expectRelayTokenRejected(
  makeUpgradeToken(caAuthorization.gatewayId, caAuthorization.secret)
);
assert(reconnectStatus === 401, `revoked reconnect returned ${reconnectStatus}, expected 401`);

await json(`/api/channels/${channel.id}/messages`, {
  method: "POST",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ content: "Message after California revocation" })
});
await tx.waitFor((frame) => frame.type === "inbound" && frame.event.text.includes("after California revocation"));

const reenrollResponse = await fetch(`${baseUrl}/relay/enroll`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer local-e2e" },
  body: JSON.stringify({
    enrollmentToken: await createEnrollment(caCookie),
    gatewayId: caAuthorization.gatewayId
  })
});
assert(reenrollResponse.status === 403, `revoked gateway re-enroll returned ${reenrollResponse.status}, expected 403`);

tx.close();

console.log("Relay E2E passed:", {
  channelId: channel.id,
  caGateway: caAuthorization.gatewayId,
  txGateway: txEnroll.gatewayId
});
