import { Pool, type PoolClient } from "pg";
import {
  type AccessKey,
  type Agent,
  type Channel,
  type ChannelMember,
  type ChannelView,
  type Delivery,
  type EnrollmentToken,
  type LlmAgent,
  type Message,
  type ProviderKey,
  type RelayInboundEvent,
  type User
} from "../types.js";
import { randomId } from "../crypto.js";

export interface Store {
  kind: "postgres" | "memory";
  init(): Promise<void>;
  close(): Promise<void>;

  createUserWithKey(input: {
    name: string;
    tokenHash: string;
    tokenPreview: string;
    label: string;
  }): Promise<{ user: User; accessKey: AccessKey }>;
  upsertEnvAccessKey(input: {
    name: string;
    tokenHash: string;
    tokenPreview: string;
  }): Promise<{ user: User; accessKey: AccessKey }>;
  getUserByAccessKeyHash(tokenHash: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  listAccessKeys(): Promise<AccessKey[]>;
  revokeAccessKey(accessKeyId: string): Promise<AccessKey | null>;

  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSessionUser(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;

  createEnrollmentToken(
    ownerUserId: string,
    tokenHash: string,
    tokenPreview: string,
    expiresAt: Date
  ): Promise<EnrollmentToken>;
  redeemEnrollmentToken(tokenHash: string): Promise<EnrollmentToken | null>;

  createAgent(input: {
    ownerUserId: string;
    gatewayId: string;
    displayName: string;
    systemLabel: string | null;
    systemType: Agent["systemType"];
    agentKind: string | null;
    secret: string;
    deliveryKey: string;
  }): Promise<Agent>;
  getAgentByGatewayId(gatewayId: string): Promise<Agent | null>;
  getAgentById(id: string): Promise<Agent | null>;
  listAgentsForUser(userId: string): Promise<Agent[]>;
  setAgentConnected(agentId: string, connected: boolean): Promise<void>;
  revokeAgent(ownerUserId: string, agentId: string): Promise<Agent | null>;

  upsertProviderKey(input: {
    ownerUserId: string;
    provider: string;
    label: string;
    encryptedKey: string;
    keyPreview: string;
  }): Promise<ProviderKey>;
  listProviderKeys(ownerUserId: string): Promise<ProviderKey[]>;
  deleteProviderKey(ownerUserId: string, providerKeyId: string): Promise<boolean>;

  createLlmAgent(input: {
    ownerUserId: string;
    name: string;
    description?: string | null;
    provider: string;
    model: string;
    role: "coordinator" | "worker";
    tools: string[];
    avatarSeed: string;
    parentId?: string | null;
  }): Promise<LlmAgent>;
  listLlmAgents(ownerUserId: string): Promise<LlmAgent[]>;
  getLlmAgentById(id: string): Promise<LlmAgent | null>;
  updateLlmAgent(
    id: string,
    patch: Partial<Pick<LlmAgent, "name" | "description" | "model" | "role" | "tools" | "parentId" | "x" | "y">>
  ): Promise<LlmAgent | null>;
  deleteLlmAgent(id: string): Promise<boolean>;

  createChannel(input: { name: string; createdBy: string }): Promise<Channel>;
  addChannelMember(channelId: string, memberKind: "user" | "agent", memberId: string): Promise<void>;
  listChannelsForUser(userId: string): Promise<ChannelView[]>;
  getChannel(channelId: string): Promise<Channel | null>;
  getChannelMembers(channelId: string): Promise<ChannelMember[]>;
  listAgentsForChannel(channelId: string): Promise<Agent[]>;
  resetChannelAgentStreak(channelId: string): Promise<Channel>;
  incrementChannelAgentStreak(channelId: string): Promise<Channel>;

  createMessage(input: {
    channelId: string;
    threadId?: string | null;
    authorKind: "user" | "agent" | "system";
    authorId: string;
    authorName: string;
    content: string;
    replyToMessageId?: string | null;
  }): Promise<Message>;
  updateMessage(messageId: string, content: string): Promise<Message | null>;
  listMessages(channelId: string, limit: number): Promise<Message[]>;

  createDelivery(input: {
    agentId: string;
    channelId: string;
    messageId: string;
    event: RelayInboundEvent;
  }): Promise<Delivery>;
  listPendingDeliveries(agentId: string, limit: number): Promise<Delivery[]>;
  markDeliveryDelivered(deliveryId: string): Promise<void>;
  markDeliveryAcked(deliveryId: string): Promise<void>;
}

const resetPasswordAuthSchema = `
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'password_hash'
  ) then
    drop table if exists delivery_queue cascade;
    drop table if exists messages cascade;
    drop table if exists channel_members cascade;
    drop table if exists channels cascade;
    drop table if exists agents cascade;
    drop table if exists enroll_tokens cascade;
    drop table if exists sessions cascade;
    drop table if exists access_keys cascade;
    drop table if exists users cascade;
  end if;
end $$;
`;

const schema = `
create table if not exists users (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists access_keys (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  token_preview text not null,
  label text not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists enroll_tokens (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  token_preview text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists agents (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  gateway_id text not null unique,
  display_name text not null,
  system_label text,
  system_type text,
  agent_kind text,
  secret text not null,
  delivery_key text not null,
  connected_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id text primary key,
  name text not null,
  created_by text not null references users(id) on delete cascade,
  agent_streak_count integer not null default 0,
  throttled_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists channel_members (
  channel_id text not null references channels(id) on delete cascade,
  member_kind text not null check (member_kind in ('user', 'agent')),
  member_id text not null,
  created_at timestamptz not null default now(),
  primary key (channel_id, member_kind, member_id)
);

create table if not exists messages (
  id text primary key,
  channel_id text not null references channels(id) on delete cascade,
  thread_id text,
  author_kind text not null check (author_kind in ('user', 'agent', 'system')),
  author_id text not null,
  author_name text not null,
  content text not null,
  reply_to_message_id text,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists delivery_queue (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  channel_id text not null references channels(id) on delete cascade,
  message_id text not null references messages(id) on delete cascade,
  event jsonb not null,
  delivered_at timestamptz,
  acked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists provider_keys (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  provider text not null,
  label text not null,
  encrypted_key text not null,
  key_preview text not null,
  created_at timestamptz not null default now(),
  unique (owner_user_id, provider)
);

create table if not exists llm_agents (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  name text not null,
  description text,
  provider text not null,
  model text not null,
  role text not null check (role in ('coordinator','worker')),
  tools jsonb not null default '[]'::jsonb,
  avatar_seed text not null,
  parent_id text references llm_agents(id) on delete set null,
  x double precision,
  y double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_access_keys_user on access_keys(user_id);
create index if not exists idx_access_keys_active on access_keys(user_id) where revoked_at is null;
create index if not exists idx_sessions_user on sessions(user_id);
create index if not exists idx_channels_created_by on channels(created_by);
create index if not exists idx_channel_members_member on channel_members(member_kind, member_id);
create index if not exists idx_messages_channel_created on messages(channel_id, created_at);
create index if not exists idx_delivery_pending on delivery_queue(agent_id, acked_at, created_at);
create index if not exists idx_provider_keys_owner on provider_keys(owner_user_id);
create index if not exists idx_llm_agents_owner on llm_agents(owner_user_id);
create index if not exists idx_llm_agents_parent on llm_agents(parent_id);

alter table agents add column if not exists system_label text;
alter table agents add column if not exists system_type text;
alter table agents add column if not exists agent_kind text;
alter table agents add column if not exists revoked_at timestamptz;
`;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapAccessKey(row: any): AccessKey {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    tokenPreview: row.token_preview,
    label: row.label,
    revokedAt: toIso(row.revoked_at),
    lastUsedAt: toIso(row.last_used_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapAgent(row: any): Agent {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    gatewayId: row.gateway_id,
    displayName: row.display_name,
    systemLabel: row.system_label ?? null,
    systemType: row.system_type ?? null,
    agentKind: row.agent_kind ?? null,
    secret: row.secret,
    deliveryKey: row.delivery_key,
    connectedAt: toIso(row.connected_at),
    lastSeenAt: toIso(row.last_seen_at),
    revokedAt: toIso(row.revoked_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapProviderKey(row: any): ProviderKey {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    provider: row.provider,
    label: row.label,
    encryptedKey: row.encrypted_key,
    keyPreview: row.key_preview,
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function parseTools(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapLlmAgent(row: any): LlmAgent {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    provider: row.provider,
    model: row.model,
    role: row.role,
    tools: parseTools(row.tools),
    avatarSeed: row.avatar_seed,
    parentId: row.parent_id,
    x: row.x == null ? null : Number(row.x),
    y: row.y == null ? null : Number(row.y),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function mapEnrollmentToken(row: any): EnrollmentToken {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    tokenHash: row.token_hash,
    tokenPreview: row.token_preview,
    expiresAt: toIso(row.expires_at) ?? new Date().toISOString(),
    usedAt: toIso(row.used_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapChannel(row: any): Channel {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    agentStreakCount: Number(row.agent_streak_count ?? 0),
    throttledUntil: toIso(row.throttled_until),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapChannelMember(row: any): ChannelMember {
  return {
    channelId: row.channel_id,
    memberKind: row.member_kind,
    memberId: row.member_id,
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    threadId: row.thread_id,
    authorKind: row.author_kind,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    replyToMessageId: row.reply_to_message_id,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    editedAt: toIso(row.edited_at)
  };
}

function mapDelivery(row: any): Delivery {
  return {
    id: row.id,
    agentId: row.agent_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    event: row.event,
    deliveredAt: toIso(row.delivered_at),
    ackedAt: toIso(row.acked_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

export class PgStore implements Store {
  kind = "postgres" as const;
  private pool: Pool;

  constructor(databaseUrl: string) {
    const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
  }

  async init(): Promise<void> {
    await this.pool.query(resetPasswordAuthSchema);
    await this.pool.query(schema);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createUserWithKey(input: {
    name: string;
    tokenHash: string;
    tokenPreview: string;
    label: string;
  }): Promise<{ user: User; accessKey: AccessKey }> {
    return this.tx(async (client) => {
      const userId = randomId("usr");
      const keyId = randomId("key");
      const userResult = await client.query("insert into users (id, name) values ($1, $2) returning *", [
        userId,
        input.name
      ]);
      const keyResult = await client.query(
        `insert into access_keys (id, user_id, token_hash, token_preview, label)
         values ($1, $2, $3, $4, $5)
         returning *, $6::text as user_name`,
        [keyId, userId, input.tokenHash, input.tokenPreview, input.label, input.name]
      );
      return { user: mapUser(userResult.rows[0]), accessKey: mapAccessKey(keyResult.rows[0]) };
    });
  }

  async upsertEnvAccessKey(input: {
    name: string;
    tokenHash: string;
    tokenPreview: string;
  }): Promise<{ user: User; accessKey: AccessKey }> {
    const label = `env:${input.name}`;
    return this.tx(async (client) => {
      const sameHash = await client.query(
        `select ak.*, u.name as user_name, u.id as user_id
         from access_keys ak
         join users u on u.id = ak.user_id
         where ak.token_hash = $1 and ak.revoked_at is null
         limit 1`,
        [input.tokenHash]
      );
      if (sameHash.rows[0]) {
        const user = await client.query("select * from users where id = $1", [sameHash.rows[0].user_id]);
        return { user: mapUser(user.rows[0]), accessKey: mapAccessKey(sameHash.rows[0]) };
      }

      const existingLabel = await client.query(
        `select ak.*, u.name as user_name, u.id as user_id
         from access_keys ak
         join users u on u.id = ak.user_id
         where ak.label = $1
         for update of ak`,
        [label]
      );
      if (existingLabel.rows[0]) {
        const row = existingLabel.rows[0];
        await client.query("update users set name = $2 where id = $1", [row.user_id, input.name]);
        const keyResult = await client.query(
          `update access_keys ak
           set token_hash = $2,
               token_preview = $3,
               label = $4,
               revoked_at = null
           from users u
           where ak.id = $1 and u.id = ak.user_id
           returning ak.*, u.name as user_name`,
          [row.id, input.tokenHash, input.tokenPreview, label]
        );
        const userResult = await client.query("select * from users where id = $1", [row.user_id]);
        return { user: mapUser(userResult.rows[0]), accessKey: mapAccessKey(keyResult.rows[0]) };
      }

      const userId = randomId("usr");
      const keyId = randomId("key");
      const userResult = await client.query("insert into users (id, name) values ($1, $2) returning *", [
        userId,
        input.name
      ]);
      const keyResult = await client.query(
        `insert into access_keys (id, user_id, token_hash, token_preview, label)
         values ($1, $2, $3, $4, $5)
         returning *, $6::text as user_name`,
        [keyId, userId, input.tokenHash, input.tokenPreview, label, input.name]
      );
      return { user: mapUser(userResult.rows[0]), accessKey: mapAccessKey(keyResult.rows[0]) };
    });
  }

  async getUserByAccessKeyHash(tokenHash: string): Promise<User | null> {
    return this.tx(async (client) => {
      const found = await client.query(
        `select u.*, ak.id as access_key_id
         from access_keys ak
         join users u on u.id = ak.user_id
         where ak.token_hash = $1 and ak.revoked_at is null
         for update of ak`,
        [tokenHash]
      );
      const row = found.rows[0];
      if (!row) return null;
      await client.query("update access_keys set last_used_at = now() where id = $1", [row.access_key_id]);
      return mapUser(row);
    });
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await this.pool.query("select * from users where id = $1", [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async listUsers(): Promise<User[]> {
    const result = await this.pool.query(
      `select distinct u.* from users u
       join access_keys ak on ak.user_id = u.id
       where ak.revoked_at is null
       order by u.created_at`
    );
    return result.rows.map(mapUser);
  }

  async listAccessKeys(): Promise<AccessKey[]> {
    const result = await this.pool.query(
      `select ak.*, u.name as user_name
       from access_keys ak
       join users u on u.id = ak.user_id
       order by ak.created_at desc`
    );
    return result.rows.map(mapAccessKey);
  }

  async revokeAccessKey(accessKeyId: string): Promise<AccessKey | null> {
    return this.tx(async (client) => {
      const updated = await client.query(
        `update access_keys ak
         set revoked_at = coalesce(ak.revoked_at, now())
         from users u
         where ak.id = $1 and u.id = ak.user_id
         returning ak.*, u.name as user_name`,
        [accessKeyId]
      );
      const row = updated.rows[0];
      if (!row) return null;
      await client.query("delete from sessions where user_id = $1", [row.user_id]);
      return mapAccessKey(row);
    });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      "insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)",
      [tokenHash, userId, expiresAt]
    );
  }

  async getSessionUser(tokenHash: string): Promise<User | null> {
    const result = await this.pool.query(
      `select u.* from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [tokenHash]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("delete from sessions where token_hash = $1", [tokenHash]);
  }

  async createEnrollmentToken(
    ownerUserId: string,
    tokenHash: string,
    tokenPreview: string,
    expiresAt: Date
  ): Promise<EnrollmentToken> {
    const id = randomId("enr");
    const result = await this.pool.query(
      `insert into enroll_tokens (id, owner_user_id, token_hash, token_preview, expires_at)
       values ($1, $2, $3, $4, $5) returning *`,
      [id, ownerUserId, tokenHash, tokenPreview, expiresAt]
    );
    return mapEnrollmentToken(result.rows[0]);
  }

  async redeemEnrollmentToken(tokenHash: string): Promise<EnrollmentToken | null> {
    return this.tx(async (client) => {
      const found = await client.query(
        `select * from enroll_tokens
         where token_hash = $1 and used_at is null and expires_at > now()
         for update`,
        [tokenHash]
      );
      if (!found.rows[0]) return null;
      const updated = await client.query(
        "update enroll_tokens set used_at = now() where id = $1 returning *",
        [found.rows[0].id]
      );
      return mapEnrollmentToken(updated.rows[0]);
    });
  }

  async createAgent(input: {
    ownerUserId: string;
    gatewayId: string;
    displayName: string;
    systemLabel: string | null;
    systemType: Agent["systemType"];
    agentKind: string | null;
    secret: string;
    deliveryKey: string;
  }): Promise<Agent> {
    const id = randomId("agt");
    const result = await this.pool.query(
      `insert into agents (
         id, owner_user_id, gateway_id, display_name, system_label, system_type, agent_kind, secret, delivery_key
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (gateway_id) do update set
         owner_user_id = excluded.owner_user_id,
         display_name = excluded.display_name,
         system_label = excluded.system_label,
         system_type = excluded.system_type,
         agent_kind = excluded.agent_kind,
         secret = excluded.secret,
         delivery_key = excluded.delivery_key
       where agents.revoked_at is null
       returning *`,
      [
        id,
        input.ownerUserId,
        input.gatewayId,
        input.displayName,
        input.systemLabel,
        input.systemType,
        input.agentKind,
        input.secret,
        input.deliveryKey
      ]
    );
    if (!result.rows[0]) throw new Error("gateway id belongs to a revoked agent");
    return mapAgent(result.rows[0]);
  }

  async getAgentByGatewayId(gatewayId: string): Promise<Agent | null> {
    const result = await this.pool.query("select * from agents where gateway_id = $1", [gatewayId]);
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async getAgentById(id: string): Promise<Agent | null> {
    const result = await this.pool.query("select * from agents where id = $1", [id]);
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async listAgentsForUser(userId: string): Promise<Agent[]> {
    const result = await this.pool.query("select * from agents where owner_user_id = $1 order by created_at", [userId]);
    return result.rows.map(mapAgent);
  }

  async setAgentConnected(agentId: string, connected: boolean): Promise<void> {
    await this.pool.query(
      connected
        ? "update agents set connected_at = now(), last_seen_at = now() where id = $1"
        : "update agents set connected_at = null, last_seen_at = now() where id = $1",
      [agentId]
    );
  }

  async revokeAgent(ownerUserId: string, agentId: string): Promise<Agent | null> {
    const result = await this.pool.query(
      `update agents
       set revoked_at = now(), connected_at = null
       where id = $1 and owner_user_id = $2 and revoked_at is null
       returning *`,
      [agentId, ownerUserId]
    );
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async upsertProviderKey(input: {
    ownerUserId: string;
    provider: string;
    label: string;
    encryptedKey: string;
    keyPreview: string;
  }): Promise<ProviderKey> {
    const id = randomId("pk");
    const result = await this.pool.query(
      `insert into provider_keys (id, owner_user_id, provider, label, encrypted_key, key_preview)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (owner_user_id, provider) do update set
         label = excluded.label,
         encrypted_key = excluded.encrypted_key,
         key_preview = excluded.key_preview,
         created_at = now()
       returning *`,
      [id, input.ownerUserId, input.provider, input.label, input.encryptedKey, input.keyPreview]
    );
    return mapProviderKey(result.rows[0]);
  }

  async listProviderKeys(ownerUserId: string): Promise<ProviderKey[]> {
    const result = await this.pool.query(
      "select * from provider_keys where owner_user_id = $1 order by created_at desc",
      [ownerUserId]
    );
    return result.rows.map(mapProviderKey);
  }

  async deleteProviderKey(ownerUserId: string, providerKeyId: string): Promise<boolean> {
    const result = await this.pool.query("delete from provider_keys where id = $1 and owner_user_id = $2", [
      providerKeyId,
      ownerUserId
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async createLlmAgent(input: {
    ownerUserId: string;
    name: string;
    description?: string | null;
    provider: string;
    model: string;
    role: "coordinator" | "worker";
    tools: string[];
    avatarSeed: string;
    parentId?: string | null;
  }): Promise<LlmAgent> {
    const id = randomId("lag");
    const result = await this.pool.query(
      `insert into llm_agents
       (id, owner_user_id, name, description, provider, model, role, tools, avatar_seed, parent_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [
        id,
        input.ownerUserId,
        input.name,
        input.description ?? null,
        input.provider,
        input.model,
        input.role,
        JSON.stringify(input.tools),
        input.avatarSeed,
        input.parentId ?? null
      ]
    );
    return mapLlmAgent(result.rows[0]);
  }

  async listLlmAgents(ownerUserId: string): Promise<LlmAgent[]> {
    const result = await this.pool.query(
      "select * from llm_agents where owner_user_id = $1 order by created_at asc",
      [ownerUserId]
    );
    return result.rows.map(mapLlmAgent);
  }

  async getLlmAgentById(id: string): Promise<LlmAgent | null> {
    const result = await this.pool.query("select * from llm_agents where id = $1", [id]);
    return result.rows[0] ? mapLlmAgent(result.rows[0]) : null;
  }

  async updateLlmAgent(
    id: string,
    patch: Partial<Pick<LlmAgent, "name" | "description" | "model" | "role" | "tools" | "parentId" | "x" | "y">>
  ): Promise<LlmAgent | null> {
    type LlmAgentPatchKey = keyof Pick<LlmAgent, "name" | "description" | "model" | "role" | "tools" | "parentId" | "x" | "y">;
    const candidates: Array<{ key: LlmAgentPatchKey; column: string; value: unknown }> = [
      { key: "name", column: "name", value: patch.name },
      { key: "description", column: "description", value: patch.description ?? null },
      { key: "model", column: "model", value: patch.model },
      { key: "role", column: "role", value: patch.role },
      { key: "tools", column: "tools", value: patch.tools == null ? undefined : JSON.stringify(patch.tools) },
      { key: "parentId", column: "parent_id", value: patch.parentId ?? null },
      { key: "x", column: "x", value: patch.x },
      { key: "y", column: "y", value: patch.y }
    ];
    const columns = candidates.filter((item) => Object.prototype.hasOwnProperty.call(patch, item.key));

    if (columns.length === 0) return this.getLlmAgentById(id);

    const sets = columns.map((item, index) => `${item.column} = $${index + 2}`);
    const result = await this.pool.query(
      `update llm_agents set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
      [id, ...columns.map((item) => item.value)]
    );
    return result.rows[0] ? mapLlmAgent(result.rows[0]) : null;
  }

  async deleteLlmAgent(id: string): Promise<boolean> {
    const result = await this.pool.query("delete from llm_agents where id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async createChannel(input: { name: string; createdBy: string }): Promise<Channel> {
    const id = randomId("chn");
    const result = await this.pool.query(
      "insert into channels (id, name, created_by) values ($1, $2, $3) returning *",
      [id, input.name, input.createdBy]
    );
    return mapChannel(result.rows[0]);
  }

  async addChannelMember(channelId: string, memberKind: "user" | "agent", memberId: string): Promise<void> {
    await this.pool.query(
      `insert into channel_members (channel_id, member_kind, member_id)
       values ($1, $2, $3) on conflict do nothing`,
      [channelId, memberKind, memberId]
    );
  }

  async listChannelsForUser(userId: string): Promise<ChannelView[]> {
    const result = await this.pool.query(
      `select distinct c.* from channels c
       join channel_members cm on cm.channel_id = c.id
       left join agents a on a.id = cm.member_id and cm.member_kind = 'agent'
       where (cm.member_kind = 'user' and cm.member_id = $1)
          or (cm.member_kind = 'agent' and a.owner_user_id = $1)
       order by c.created_at desc`,
      [userId]
    );
    const channels = result.rows.map(mapChannel);
    return Promise.all(channels.map(async (channel) => ({ ...channel, members: await this.getChannelMembers(channel.id) })));
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const result = await this.pool.query("select * from channels where id = $1", [channelId]);
    return result.rows[0] ? mapChannel(result.rows[0]) : null;
  }

  async getChannelMembers(channelId: string): Promise<ChannelMember[]> {
    const result = await this.pool.query("select * from channel_members where channel_id = $1 order by created_at", [
      channelId
    ]);
    return result.rows.map(mapChannelMember);
  }

  async listAgentsForChannel(channelId: string): Promise<Agent[]> {
    const result = await this.pool.query(
      `select a.* from agents a
       join channel_members cm on cm.member_id = a.id and cm.member_kind = 'agent'
       where cm.channel_id = $1 and a.revoked_at is null
       order by a.created_at`,
      [channelId]
    );
    return result.rows.map(mapAgent);
  }

  async resetChannelAgentStreak(channelId: string): Promise<Channel> {
    const result = await this.pool.query(
      "update channels set agent_streak_count = 0, throttled_until = null where id = $1 returning *",
      [channelId]
    );
    return mapChannel(result.rows[0]);
  }

  async incrementChannelAgentStreak(channelId: string): Promise<Channel> {
    const result = await this.pool.query(
      `update channels
       set agent_streak_count = agent_streak_count + 1,
           throttled_until = case when agent_streak_count + 1 > 6 then now() + interval '5 minutes' else throttled_until end
       where id = $1 returning *`,
      [channelId]
    );
    return mapChannel(result.rows[0]);
  }

  async createMessage(input: {
    channelId: string;
    threadId?: string | null;
    authorKind: "user" | "agent" | "system";
    authorId: string;
    authorName: string;
    content: string;
    replyToMessageId?: string | null;
  }): Promise<Message> {
    const id = randomId("msg");
    const result = await this.pool.query(
      `insert into messages
       (id, channel_id, thread_id, author_kind, author_id, author_name, content, reply_to_message_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        id,
        input.channelId,
        input.threadId ?? null,
        input.authorKind,
        input.authorId,
        input.authorName,
        input.content,
        input.replyToMessageId ?? null
      ]
    );
    return mapMessage(result.rows[0]);
  }

  async updateMessage(messageId: string, content: string): Promise<Message | null> {
    const result = await this.pool.query(
      "update messages set content = $2, edited_at = now() where id = $1 returning *",
      [messageId, content]
    );
    return result.rows[0] ? mapMessage(result.rows[0]) : null;
  }

  async listMessages(channelId: string, limit: number): Promise<Message[]> {
    const result = await this.pool.query(
      `select * from messages where channel_id = $1 order by created_at desc limit $2`,
      [channelId, limit]
    );
    return result.rows.map(mapMessage).reverse();
  }

  async createDelivery(input: {
    agentId: string;
    channelId: string;
    messageId: string;
    event: RelayInboundEvent;
  }): Promise<Delivery> {
    const id = randomId("dlv");
    const result = await this.pool.query(
      `insert into delivery_queue (id, agent_id, channel_id, message_id, event)
       values ($1, $2, $3, $4, $5) returning *`,
      [id, input.agentId, input.channelId, input.messageId, JSON.stringify(input.event)]
    );
    return mapDelivery(result.rows[0]);
  }

  async listPendingDeliveries(agentId: string, limit: number): Promise<Delivery[]> {
    const result = await this.pool.query(
      `select * from delivery_queue
       where agent_id = $1 and acked_at is null
       order by created_at asc limit $2`,
      [agentId, limit]
    );
    return result.rows.map(mapDelivery);
  }

  async markDeliveryDelivered(deliveryId: string): Promise<void> {
    await this.pool.query("update delivery_queue set delivered_at = coalesce(delivered_at, now()) where id = $1", [
      deliveryId
    ]);
  }

  async markDeliveryAcked(deliveryId: string): Promise<void> {
    await this.pool.query("update delivery_queue set delivered_at = coalesce(delivered_at, now()), acked_at = now() where id = $1", [
      deliveryId
    ]);
  }
}

export class MemoryStore implements Store {
  kind = "memory" as const;
  private users = new Map<string, User>();
  private accessKeys = new Map<string, AccessKey & { tokenHash: string }>();
  private sessions = new Map<string, { userId: string; expiresAt: string }>();
  private enrollTokens = new Map<string, EnrollmentToken>();
  private agents = new Map<string, Agent>();
  private providerKeys = new Map<string, ProviderKey>();
  private llmAgents = new Map<string, LlmAgent>();
  private channels = new Map<string, Channel>();
  private channelMembers = new Map<string, ChannelMember>();
  private messages = new Map<string, Message>();
  private deliveries = new Map<string, Delivery>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createUserWithKey(input: {
    name: string;
    tokenHash: string;
    tokenPreview: string;
    label: string;
  }): Promise<{ user: User; accessKey: AccessKey }> {
    const id = randomId("usr");
    const user = { id, name: input.name, createdAt: new Date().toISOString() };
    const accessKey = {
      id: randomId("key"),
      userId: id,
      userName: user.name,
      tokenHash: input.tokenHash,
      tokenPreview: input.tokenPreview,
      label: input.label,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString()
    };
    this.users.set(id, user);
    this.accessKeys.set(accessKey.id, accessKey);
    return { user, accessKey: this.publicAccessKey(accessKey) };
  }

  async upsertEnvAccessKey(input: {
    name: string;
    tokenHash: string;
    tokenPreview: string;
  }): Promise<{ user: User; accessKey: AccessKey }> {
    const label = `env:${input.name}`;
    const sameHash = [...this.accessKeys.values()].find((key) => key.tokenHash === input.tokenHash && !key.revokedAt);
    if (sameHash) {
      const user = await this.getUserById(sameHash.userId);
      if (!user) throw new Error("access key user not found");
      return { user, accessKey: this.publicAccessKey(sameHash) };
    }

    const existing = [...this.accessKeys.values()].find((key) => key.label === label);
    if (existing) {
      const user = this.users.get(existing.userId);
      if (!user) throw new Error("access key user not found");
      user.name = input.name;
      existing.userName = input.name;
      existing.tokenHash = input.tokenHash;
      existing.tokenPreview = input.tokenPreview;
      existing.label = label;
      existing.revokedAt = null;
      return { user, accessKey: this.publicAccessKey(existing) };
    }

    return this.createUserWithKey({
      name: input.name,
      tokenHash: input.tokenHash,
      tokenPreview: input.tokenPreview,
      label
    });
  }

  async getUserByAccessKeyHash(tokenHash: string): Promise<User | null> {
    const accessKey = [...this.accessKeys.values()].find((key) => key.tokenHash === tokenHash && !key.revokedAt);
    if (!accessKey) return null;
    accessKey.lastUsedAt = new Date().toISOString();
    return this.getUserById(accessKey.userId);
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async listUsers(): Promise<User[]> {
    const activeUserIds = new Set(
      [...this.accessKeys.values()].filter((accessKey) => !accessKey.revokedAt).map((accessKey) => accessKey.userId)
    );
    return [...this.users.values()].filter((user) => activeUserIds.has(user.id));
  }

  async listAccessKeys(): Promise<AccessKey[]> {
    return [...this.accessKeys.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((accessKey) => this.publicAccessKey(accessKey));
  }

  async revokeAccessKey(accessKeyId: string): Promise<AccessKey | null> {
    const accessKey = this.accessKeys.get(accessKeyId);
    if (!accessKey) return null;
    accessKey.revokedAt ??= new Date().toISOString();
    for (const [tokenHash, session] of this.sessions) {
      if (session.userId === accessKey.userId) this.sessions.delete(tokenHash);
    }
    return this.publicAccessKey(accessKey);
  }

  private publicAccessKey(accessKey: AccessKey & { tokenHash: string }): AccessKey {
    const { tokenHash: _tokenHash, ...safe } = accessKey;
    return safe;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt: expiresAt.toISOString() });
  }

  async getSessionUser(tokenHash: string): Promise<User | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
    return this.getUserById(session.userId);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async createEnrollmentToken(
    ownerUserId: string,
    tokenHash: string,
    tokenPreview: string,
    expiresAt: Date
  ): Promise<EnrollmentToken> {
    const token = {
      id: randomId("enr"),
      ownerUserId,
      tokenHash,
      tokenPreview,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString()
    };
    this.enrollTokens.set(tokenHash, token);
    return token;
  }

  async redeemEnrollmentToken(tokenHash: string): Promise<EnrollmentToken | null> {
    const token = this.enrollTokens.get(tokenHash);
    if (!token || token.usedAt || Date.parse(token.expiresAt) < Date.now()) return null;
    token.usedAt = new Date().toISOString();
    return token;
  }

  async createAgent(input: {
    ownerUserId: string;
    gatewayId: string;
    displayName: string;
    systemLabel: string | null;
    systemType: Agent["systemType"];
    agentKind: string | null;
    secret: string;
    deliveryKey: string;
  }): Promise<Agent> {
    const existing = [...this.agents.values()].find((agent) => agent.gatewayId === input.gatewayId);
    if (existing?.revokedAt) throw new Error("gateway id belongs to a revoked agent");
    const agent: Agent = {
      id: existing?.id ?? randomId("agt"),
      ownerUserId: input.ownerUserId,
      gatewayId: input.gatewayId,
      displayName: input.displayName,
      systemLabel: input.systemLabel,
      systemType: input.systemType,
      agentKind: input.agentKind,
      secret: input.secret,
      deliveryKey: input.deliveryKey,
      connectedAt: existing?.connectedAt ?? null,
      lastSeenAt: existing?.lastSeenAt ?? null,
      revokedAt: null,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async getAgentByGatewayId(gatewayId: string): Promise<Agent | null> {
    return [...this.agents.values()].find((agent) => agent.gatewayId === gatewayId) ?? null;
  }

  async getAgentById(id: string): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async listAgentsForUser(userId: string): Promise<Agent[]> {
    return [...this.agents.values()].filter((agent) => agent.ownerUserId === userId);
  }

  async setAgentConnected(agentId: string, connected: boolean): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const now = new Date().toISOString();
    agent.connectedAt = connected ? now : null;
    agent.lastSeenAt = now;
  }

  async revokeAgent(ownerUserId: string, agentId: string): Promise<Agent | null> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.ownerUserId !== ownerUserId || agent.revokedAt) return null;
    agent.revokedAt = new Date().toISOString();
    agent.connectedAt = null;
    return agent;
  }

  async upsertProviderKey(input: {
    ownerUserId: string;
    provider: string;
    label: string;
    encryptedKey: string;
    keyPreview: string;
  }): Promise<ProviderKey> {
    const existing = [...this.providerKeys.values()].find(
      (providerKey) => providerKey.ownerUserId === input.ownerUserId && providerKey.provider === input.provider
    );
    const providerKey: ProviderKey = {
      id: existing?.id ?? randomId("pk"),
      ownerUserId: input.ownerUserId,
      provider: input.provider,
      label: input.label,
      encryptedKey: input.encryptedKey,
      keyPreview: input.keyPreview,
      createdAt: new Date().toISOString()
    };
    this.providerKeys.set(providerKey.id, providerKey);
    return providerKey;
  }

  async listProviderKeys(ownerUserId: string): Promise<ProviderKey[]> {
    return [...this.providerKeys.values()]
      .filter((providerKey) => providerKey.ownerUserId === ownerUserId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async deleteProviderKey(ownerUserId: string, providerKeyId: string): Promise<boolean> {
    const providerKey = this.providerKeys.get(providerKeyId);
    if (!providerKey || providerKey.ownerUserId !== ownerUserId) return false;
    this.providerKeys.delete(providerKeyId);
    return true;
  }

  async createLlmAgent(input: {
    ownerUserId: string;
    name: string;
    description?: string | null;
    provider: string;
    model: string;
    role: "coordinator" | "worker";
    tools: string[];
    avatarSeed: string;
    parentId?: string | null;
  }): Promise<LlmAgent> {
    const now = new Date().toISOString();
    const llmAgent: LlmAgent = {
      id: randomId("lag"),
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description ?? null,
      provider: input.provider,
      model: input.model,
      role: input.role,
      tools: [...input.tools],
      avatarSeed: input.avatarSeed,
      parentId: input.parentId ?? null,
      x: null,
      y: null,
      createdAt: now,
      updatedAt: now
    };
    this.llmAgents.set(llmAgent.id, llmAgent);
    return llmAgent;
  }

  async listLlmAgents(ownerUserId: string): Promise<LlmAgent[]> {
    return [...this.llmAgents.values()]
      .filter((llmAgent) => llmAgent.ownerUserId === ownerUserId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async getLlmAgentById(id: string): Promise<LlmAgent | null> {
    return this.llmAgents.get(id) ?? null;
  }

  async updateLlmAgent(
    id: string,
    patch: Partial<Pick<LlmAgent, "name" | "description" | "model" | "role" | "tools" | "parentId" | "x" | "y">>
  ): Promise<LlmAgent | null> {
    const llmAgent = this.llmAgents.get(id);
    if (!llmAgent) return null;
    if (Object.prototype.hasOwnProperty.call(patch, "name")) llmAgent.name = patch.name ?? llmAgent.name;
    if (Object.prototype.hasOwnProperty.call(patch, "description")) llmAgent.description = patch.description ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "model")) llmAgent.model = patch.model ?? llmAgent.model;
    if (Object.prototype.hasOwnProperty.call(patch, "role") && patch.role) llmAgent.role = patch.role;
    if (Object.prototype.hasOwnProperty.call(patch, "tools")) llmAgent.tools = [...(patch.tools ?? [])];
    if (Object.prototype.hasOwnProperty.call(patch, "parentId")) llmAgent.parentId = patch.parentId ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "x")) llmAgent.x = patch.x ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "y")) llmAgent.y = patch.y ?? null;
    llmAgent.updatedAt = new Date().toISOString();
    return llmAgent;
  }

  async deleteLlmAgent(id: string): Promise<boolean> {
    if (!this.llmAgents.delete(id)) return false;
    const now = new Date().toISOString();
    for (const llmAgent of this.llmAgents.values()) {
      if (llmAgent.parentId === id) {
        llmAgent.parentId = null;
        llmAgent.updatedAt = now;
      }
    }
    return true;
  }

  async createChannel(input: { name: string; createdBy: string }): Promise<Channel> {
    const channel: Channel = {
      id: randomId("chn"),
      name: input.name,
      createdBy: input.createdBy,
      agentStreakCount: 0,
      throttledUntil: null,
      createdAt: new Date().toISOString()
    };
    this.channels.set(channel.id, channel);
    return channel;
  }

  async addChannelMember(channelId: string, memberKind: "user" | "agent", memberId: string): Promise<void> {
    const member: ChannelMember = { channelId, memberKind, memberId, createdAt: new Date().toISOString() };
    this.channelMembers.set(`${channelId}:${memberKind}:${memberId}`, member);
  }

  async listChannelsForUser(userId: string): Promise<ChannelView[]> {
    const visible = [...this.channels.values()].filter((channel) => {
      const members = [...this.channelMembers.values()].filter((member) => member.channelId === channel.id);
      return members.some(
        (member) =>
          (member.memberKind === "user" && member.memberId === userId) ||
          (member.memberKind === "agent" && this.agents.get(member.memberId)?.ownerUserId === userId)
      );
    });
    return visible.map((channel) => ({
      ...channel,
      members: [...this.channelMembers.values()].filter((member) => member.channelId === channel.id)
    }));
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    return this.channels.get(channelId) ?? null;
  }

  async getChannelMembers(channelId: string): Promise<ChannelMember[]> {
    return [...this.channelMembers.values()].filter((member) => member.channelId === channelId);
  }

  async listAgentsForChannel(channelId: string): Promise<Agent[]> {
    return (await this.getChannelMembers(channelId))
      .filter((member) => member.memberKind === "agent")
      .map((member) => this.agents.get(member.memberId))
      .filter((agent): agent is Agent => Boolean(agent && !agent.revokedAt));
  }

  async resetChannelAgentStreak(channelId: string): Promise<Channel> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error("channel not found");
    channel.agentStreakCount = 0;
    channel.throttledUntil = null;
    return channel;
  }

  async incrementChannelAgentStreak(channelId: string): Promise<Channel> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error("channel not found");
    channel.agentStreakCount += 1;
    if (channel.agentStreakCount > 6) {
      channel.throttledUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
    return channel;
  }

  async createMessage(input: {
    channelId: string;
    threadId?: string | null;
    authorKind: "user" | "agent" | "system";
    authorId: string;
    authorName: string;
    content: string;
    replyToMessageId?: string | null;
  }): Promise<Message> {
    const message: Message = {
      id: randomId("msg"),
      channelId: input.channelId,
      threadId: input.threadId ?? null,
      authorKind: input.authorKind,
      authorId: input.authorId,
      authorName: input.authorName,
      content: input.content,
      replyToMessageId: input.replyToMessageId ?? null,
      createdAt: new Date().toISOString(),
      editedAt: null
    };
    this.messages.set(message.id, message);
    return message;
  }

  async updateMessage(messageId: string, content: string): Promise<Message | null> {
    const message = this.messages.get(messageId);
    if (!message) return null;
    message.content = content;
    message.editedAt = new Date().toISOString();
    return message;
  }

  async listMessages(channelId: string, limit: number): Promise<Message[]> {
    return [...this.messages.values()]
      .filter((message) => message.channelId === channelId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(-limit);
  }

  async createDelivery(input: {
    agentId: string;
    channelId: string;
    messageId: string;
    event: RelayInboundEvent;
  }): Promise<Delivery> {
    const delivery: Delivery = {
      id: randomId("dlv"),
      agentId: input.agentId,
      channelId: input.channelId,
      messageId: input.messageId,
      event: input.event,
      deliveredAt: null,
      ackedAt: null,
      createdAt: new Date().toISOString()
    };
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  async listPendingDeliveries(agentId: string, limit: number): Promise<Delivery[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.agentId === agentId && !delivery.ackedAt)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit);
  }

  async markDeliveryDelivered(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (delivery && !delivery.deliveredAt) delivery.deliveredAt = new Date().toISOString();
  }

  async markDeliveryAcked(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;
    delivery.deliveredAt ??= new Date().toISOString();
    delivery.ackedAt = new Date().toISOString();
  }
}

export function createStore(): Store {
  if (process.env.DATABASE_URL) {
    return new PgStore(process.env.DATABASE_URL);
  }
  return new MemoryStore();
}
