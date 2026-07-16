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

function encryptionKey(): Buffer {
  const secret =
    process.env.KEY_ENCRYPTION_SECRET ||
    process.env.APP_SECRET ||
    process.env.COOKIE_SECRET ||
    "dev-cookie-secret-change-me";
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivRaw, tagRaw, cipherRaw] = payload.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !cipherRaw) {
    throw new Error("Unsupported encrypted secret payload.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
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
  if (Math.floor(Date.now() / 1000) > exp) {
    return { ok: false, reason: "token expired" };
  }

  const expected = hmacHex(`${gatewayId}:${exp}`, secret);
  if (!constantTimeHexEqual(sig, expected)) {
    return { ok: false, reason: "bad signature" };
  }

  return { ok: true, gatewayId };
}
