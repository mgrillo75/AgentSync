import crypto from "node:crypto";
import WebSocket from "ws";
import { isCorrelatedNexusReply } from "../web/src/lib/nexusReply.js";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3100";
const relayUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/relay";
const browserUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/browser";
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

class FrameClient {
  constructor() {
    this.frames = [];
    this.waiters = [];
  }

  record(frame) {
    this.frames.push(frame);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(frame)) {
        clearTimeout(waiter.timeout);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        waiter.resolve(frame);
      }
    }
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
          reject(new Error("timed out waiting for frame"));
        }, ms)
      };
      this.waiters.push(waiter);
    });
  }
}

class BrowserClient extends FrameClient {
  constructor(cookie) {
    super();
    this.ws = new WebSocket(browserUrl, { headers: { Cookie: cookie } });
  }

  async open() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("browser client timed out opening")), 5000);
        this.ws.once("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        this.ws.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }
    this.ws.on("message", (data) => this.record(JSON.parse(data.toString("utf8"))));
  }

  close() {
    this.ws.close();
  }
}

class RelayClient extends FrameClient {
  constructor(name, gatewayId, secret) {
    super();
    this.name = name;
    this.gatewayId = gatewayId;
    this.buffer = "";
    this.autoAck = true;
    this.ws = new WebSocket(relayUrl, {
      headers: { Authorization: `Bearer ${makeUpgradeToken(gatewayId, secret)}` }
    });
  }

  async open() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${this.name} timed out opening`)), 5000);
        this.ws.once("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        this.ws.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }
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
      this.record(frame);
      if (this.autoAck && frame.type === "inbound" && frame.bufferId) this.ack(frame);
    }
  }

  send(frame) {
    this.ws.send(`${JSON.stringify(frame)}\n`);
  }

  ack(frame) {
    this.send({ type: "inbound_ack", bufferId: frame.bufferId });
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
assert(founder.user.platformRole === "platform_admin", "environment founder was not marked as platform administrator");
assert(caMember.user.platformRole === "member", "created access-key user was not marked as a member");

const waoName = `E2E Client WAO ${unique}`;
const { body: createdWaoBody } = await json("/api/wao-instances", {
  method: "POST",
  headers: { Cookie: founder.cookie },
  body: JSON.stringify({ name: waoName })
});
assert(createdWaoBody.instance.name === waoName, "WAO instance creation returned the wrong name");
assert(createdWaoBody.instance.status === "active", "WAO instance was not created active");
assert(createdWaoBody.instance.createdBy === founder.user.id, "WAO instance creator mismatch");

const { body: waoListBody } = await json("/api/wao-instances", { headers: { Cookie: founder.cookie } });
assert(waoListBody.instances.some((instance) => instance.id === createdWaoBody.instance.id), "created WAO instance was not listed");
const { body: waoDetailBody } = await json(`/api/wao-instances/${createdWaoBody.instance.id}`, {
  headers: { Cookie: founder.cookie }
});
assert(waoDetailBody.instance.id === createdWaoBody.instance.id, "WAO instance detail mismatch");

const missingWaoResponse = await fetch(`${baseUrl}/api/wao-instances/wao_missing`, {
  headers: { Cookie: founder.cookie }
});
assert(missingWaoResponse.status === 404, `missing WAO instance returned ${missingWaoResponse.status}, expected 404`);

const deniedWaoResponse = await fetch(`${baseUrl}/api/wao-instances`, { headers: { Cookie: caCookie } });
assert(deniedWaoResponse.status === 403, `member WAO instance access returned ${deniedWaoResponse.status}, expected 403`);
const caAuthorization = await createAuthorization(caCookie);
const txEnroll = await enroll(await createEnrollment(txCookie), `gw-tx-${unique}`);
console.log("[e2e] identities and WAO instance authorization ready");

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

const browser = new BrowserClient(caCookie);

await browser.open();
const { body: queuedDirect } = await json(`/api/agents/${caAuthorization.agent.id}/messages`, {
  method: "POST",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ content: "Queued direct nexus ping" })
});
assert(queuedDirect.channel.kind === "dm", "direct send did not return its DM channel");
assert(queuedDirect.delivery?.status === "queued", `offline direct send was not reported as queued: ${JSON.stringify(queuedDirect.delivery)}`);
const queuedEvent = await browser.waitFor((frame) => frame.type === "delivery_status" && frame.deliveryId === queuedDirect.delivery.delivery.id && frame.status === "queued");
assert(queuedEvent.messageId === queuedDirect.message.id, "queued event message correlation mismatch");
assert(queuedEvent.agentId === caAuthorization.agent.id, "queued event agent correlation mismatch");
assert(queuedEvent.channelId === queuedDirect.channel.id, "queued event channel correlation mismatch");
assert(!browser.frames.some((frame) => frame.type === "delivery_status" && frame.deliveryId === queuedDirect.delivery.delivery.id && frame.status === "received"), "offline delivery was marked received before reconnect");
console.log("[e2e] queued delivery verified");

const ca = new RelayClient("California", caAuthorization.gatewayId, caAuthorization.secret);
const tx = new RelayClient("Texas", txEnroll.gatewayId, txEnroll.secret);
await Promise.all([ca.open(), tx.open()]);
await ca.waitFor((frame) => frame.type === "inbound" && frame.event.text === "Queued direct nexus ping");
const replayReceipt = await browser.waitFor((frame) => frame.type === "delivery_status" && frame.deliveryId === queuedDirect.delivery.delivery.id && frame.status === "received");
assert(replayReceipt.messageId === queuedDirect.message.id, "reconnect receipt lost message correlation");
console.log("[e2e] relay clients connected and backlog drained");

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
console.log("[e2e] shared relay exchange verified");

ca.autoAck = false;
const { body: directSend } = await json(`/api/agents/${caAuthorization.agent.id}/messages`, {
  method: "POST",
  headers: { Cookie: caCookie },
  body: JSON.stringify({ content: "Direct nexus ping" })
});
assert(directSend.channel.kind === "dm", "direct send response omitted DM channel");
assert(directSend.delivery.status === "sent", "connected direct send was not reported as sent");
const sentEvent = await browser.waitFor((frame) => frame.type === "delivery_status" && frame.deliveryId === directSend.delivery.delivery.id && frame.status === "sent");
assert(sentEvent.messageId === directSend.message.id, "sent event message correlation mismatch");
const directFrame = await ca.waitFor((frame) => frame.type === "inbound" && frame.event.text === "Direct nexus ping");
assert(directFrame.event.source.chat_id !== channel.id, "direct message reused the shared channel");
await new Promise((resolve) => setTimeout(resolve, 300));
assert(!tx.frames.some((frame) => frame.type === "inbound" && frame.event.text === "Direct nexus ping"), "direct message reached the non-target agent");
assert(!browser.frames.some((frame) => frame.type === "delivery_status" && frame.deliveryId === directSend.delivery.delivery.id && frame.status === "received"), "delivery was marked received before Hermes acknowledged it");
tx.send({ type: "inbound_ack", bufferId: directFrame.bufferId });
await new Promise((resolve) => setTimeout(resolve, 300));
assert(!browser.frames.some((frame) => frame.type === "delivery_status" && frame.deliveryId === directSend.delivery.delivery.id && frame.status === "received"), "non-target agent falsely acknowledged the delivery");

const pendingDirect = { agentId: caAuthorization.agent.id, channelId: directSend.channel.id };
assert(!isCorrelatedNexusReply({
  authorKind: "agent",
  authorId: caAuthorization.agent.id,
  channelId: directSend.channel.id,
  replyToMessageId: null
}, directSend.message.id, pendingDirect), "unsolicited agent message falsely confirmed the pending send");
assert(!isCorrelatedNexusReply({
  authorKind: "agent",
  authorId: caAuthorization.agent.id,
  channelId: directSend.channel.id,
  replyToMessageId: queuedDirect.message.id
}, directSend.message.id, pendingDirect), "reply to another message falsely confirmed the pending send");
assert(!isCorrelatedNexusReply({
  authorKind: "agent",
  authorId: "agt_unrelated",
  channelId: directSend.channel.id,
  replyToMessageId: directSend.message.id
}, directSend.message.id, pendingDirect), "reply from another agent falsely confirmed the pending send");
assert(!isCorrelatedNexusReply({
  authorKind: "agent",
  authorId: caAuthorization.agent.id,
  channelId: channel.id,
  replyToMessageId: directSend.message.id
}, directSend.message.id, pendingDirect), "reply in another channel falsely confirmed the pending send");

const directReplyRequestId = crypto.randomUUID().replaceAll("-", "");
ca.send({
  type: "outbound",
  requestId: directReplyRequestId,
  action: {
    op: "send",
    chat_id: directSend.channel.id,
    content: "Hermes confirms the direct message",
    reply_to: directSend.message.id
  }
});
const directReplyResult = await ca.waitFor((frame) => frame.type === "outbound_result" && frame.requestId === directReplyRequestId);
assert(directReplyResult.result.success === true, "Hermes direct reply failed");
const receipt = await browser.waitFor((frame) => frame.type === "delivery_status" && frame.deliveryId === directSend.delivery.delivery.id && frame.status === "received");
assert(receipt.messageId === directSend.message.id, "correlated reply receipt lost message correlation");
const directReplyEvent = await browser.waitFor((frame) => frame.type === "message" && frame.message?.id === directReplyResult.result.message_id);
assert(directReplyEvent.message.authorId === caAuthorization.agent.id, "direct reply author did not match target agent");
assert(directReplyEvent.message.channelId === directSend.channel.id, "direct reply channel did not match pending DM");
assert(directReplyEvent.message.replyToMessageId === directSend.message.id, "direct reply did not correlate to Papa's message");
assert(isCorrelatedNexusReply(directReplyEvent.message, directSend.message.id, pendingDirect), "matching Hermes reply did not satisfy the client correlation predicate");
console.log("[e2e] correlated reply reconciled receipt without inbound_ack");

const intentionalClose = ca.waitForClose();
ca.close();
await intentionalClose;
const caReconnected = new RelayClient("California reconnect", caAuthorization.gatewayId, caAuthorization.secret);
await caReconnected.open();
await new Promise((resolve) => setTimeout(resolve, 500));
assert(
  !caReconnected.frames.some((frame) => frame.type === "inbound" && frame.event.text === "Direct nexus ping"),
  "correlated reply delivery replayed after reconnect"
);
console.log("[e2e] correlated reply prevented reconnect replay");

const { body: nexusBody } = await json("/api/nexus/graph", { headers: { Cookie: caCookie } });
assert(nexusBody.member.id === caMember.user.id, "Nexus member mismatch");
assert(nexusBody.agents.some((agent) => agent.id === caAuthorization.agent.id), "Nexus omitted connected agent");
assert(nexusBody.links.some((link) =>
  [link.fromId, link.toId].includes(caMember.user.id) && [link.fromId, link.toId].includes(caAuthorization.agent.id)
), "Nexus omitted member-agent communication link");
const directLink = nexusBody.links.find((link) =>
  [link.fromId, link.toId].includes(caMember.user.id) && [link.fromId, link.toId].includes(caAuthorization.agent.id)
);
assert(directLink?.count >= 1, "Nexus did not count the first direct message");

const { body: channelList } = await json("/api/channels", { headers: { Cookie: caCookie } });
const dmChannels = channelList.channels.filter((item) => item.kind === "dm");
assert(dmChannels.length === 1, `expected one DM channel, found ${dmChannels.length}`);
assert(dmChannels[0].dmAgentId === caAuthorization.agent.id, "DM channel target mismatch");

const closePromise = caReconnected.waitForClose();
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
console.log("[e2e] revocation verified");

tx.close();
browser.close();

console.log("Relay E2E passed:", {
  channelId: channel.id,
  caGateway: caAuthorization.gatewayId,
  txGateway: txEnroll.gatewayId
});
