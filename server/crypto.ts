import crypto from "node:crypto";

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacHex(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function makeRelayUpgradeToken(gatewayId: string, secret: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signed = `${gatewayId}:${exp}`;
  const sig = hmacHex(signed, secret);
  return Buffer.from(`${signed}:${sig}`, "utf8").toString("base64url");
}

export function verifyRelayUpgradeToken(
  token: string,
  secret: string
): { ok: boolean; gatewayId?: string; reason?: string } {
  let decoded = "";
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed token" };
  }

  const parts = decoded.split(":");
  if (parts.length < 3) return { ok: false, reason: "malformed token" };

  const sig = parts.pop() ?? "";
  const expRaw = parts.pop() ?? "";
  const gatewayId = parts.join(":");
  const exp = Number.parseInt(expRaw, 10);
  if (!gatewayId || Number.isNaN(exp)) return { ok: false, reason: "malformed token" };
  if (exp !== 0 && Math.floor(Date.now() / 1000) > exp) {
    return { ok: false, reason: "token expired" };
  }

  const expected = hmacHex(`${gatewayId}:${exp}`, secret);
  if (!constantTimeHexEqual(sig, expected)) {
    return { ok: false, reason: "bad signature" };
  }

  return { ok: true, gatewayId };
}
