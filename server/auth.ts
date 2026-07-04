import type { FastifyReply, FastifyRequest } from "fastify";
import { compare, hash } from "bcryptjs";
import { randomSecret, sha256 } from "./crypto.js";
import type { Store } from "./db/store.js";
import type { User } from "./types.js";

const COOKIE_NAME = "agentsync_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

export async function createLoginSession(store: Store, reply: FastifyReply, userId: string): Promise<void> {
  const token = randomSecret(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await store.createSession(userId, sha256(token), expiresAt);
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function clearLoginSession(store: Store, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[COOKIE_NAME];
  if (token) {
    await store.deleteSession(sha256(token));
  }
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export async function currentUser(store: Store, request: FastifyRequest): Promise<User | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;
  return store.getSessionUser(sha256(token));
}

export async function requireUser(store: Store, request: FastifyRequest): Promise<User> {
  const user = await currentUser(store, request);
  if (!user) {
    const error = new Error("unauthorized") as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  }
  return user;
}
