import { Pool, type PoolClient } from "pg";
import {
  type AccessKey,
  type Agent,
  type Channel,
  type ChannelMember,
  type ChannelView,
  type Delivery,
  type EnrollmentToken,
  type Message,
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
    secret: string;
    deliveryKey: string;
  }): Promise<Agent>;
  getAgentByGatewayId(gatewayId: string): Promise<Agent | null>;
  getAgentById(id: string): Promise<Agent | null>;
  listAgentsForUser(userId: string): Promise<Agent[]>;
  setAgentConnected(agentId: string, connected: boolean): Promise<void>;

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
  secret text not null,
  delivery_key text not null,
  connected_at timestamptz,
  last_seen_at timestamptz,
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

create index if not exists idx_access_keys_user on access_keys(user_id);
create index if not exists idx_access_keys_active on access_keys(user_id) where revoked_at is null;
create index if not exists idx_sessions_user on sessions(user_id);
create index if not exists idx_channels_created_by on channels(created_by);
create index if not exists idx_channel_members_member on channel_members(member_kind, member_id);
create index if not exists idx_messages_channel_created on messages(channel_id, created_at);
create index if not exists idx_delivery_pending on delivery_queue(agent_id, acked_at, created_at);
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
    secret: row.secret,
    deliveryKey: row.delivery_key,
    connectedAt: toIso(row.connected_at),
    lastSeenAt: toIso(row.last_seen_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
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
    secret: string;
    deliveryKey: string;
  }): Promise<Agent> {
    const id = randomId("agt");
    const result = await this.pool.query(
      `insert into agents (id, owner_user_id, gateway_id, display_name, secret, delivery_key)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (gateway_id) do update set
         owner_user_id = excluded.owner_user_id,
         display_name = excluded.display_name,
         secret = excluded.secret,
         delivery_key = excluded.delivery_key
       returning *`,
      [id, input.ownerUserId, input.gatewayId, input.displayName, input.secret, input.deliveryKey]
    );
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
       where cm.channel_id = $1
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
    secret: string;
    deliveryKey: string;
  }): Promise<Agent> {
    const existing = [...this.agents.values()].find((agent) => agent.gatewayId === input.gatewayId);
    const agent: Agent = {
      id: existing?.id ?? randomId("agt"),
      ownerUserId: input.ownerUserId,
      gatewayId: input.gatewayId,
      displayName: input.displayName,
      secret: input.secret,
      deliveryKey: input.deliveryKey,
      connectedAt: existing?.connectedAt ?? null,
      lastSeenAt: existing?.lastSeenAt ?? null,
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
      .filter((agent): agent is Agent => Boolean(agent));
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
