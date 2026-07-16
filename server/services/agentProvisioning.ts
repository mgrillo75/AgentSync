import { decryptSecret, encryptSecret, randomSecret } from "../crypto.js";
import type { Store } from "../db/store.js";
import type { Agent } from "../types.js";

export type ProvisionedAgent = {
  agent: Agent;
  secret: string;
  deliveryKey: string;
};

export async function provisionAgentForOwner(
  store: Store,
  input: {
    ownerUserId: string;
    gatewayId: string;
    displayName?: string;
    systemLabel?: string | null;
    systemType?: Agent["systemType"];
    agentKind?: string | null;
    secret?: string;
    deliveryKey?: string;
  }
): Promise<ProvisionedAgent> {
  const secret = input.secret ?? randomSecret(32);
  const deliveryKey = input.deliveryKey ?? randomSecret(32);
  const agent = await store.createAgent({
    ownerUserId: input.ownerUserId,
    gatewayId: input.gatewayId,
    displayName: input.displayName ?? `Hermes ${input.gatewayId.replace(/^gw-/, "")}`,
    systemLabel: input.systemLabel ?? null,
    systemType: input.systemType ?? null,
    agentKind: input.agentKind ?? null,
    secret: encryptSecret(secret),
    deliveryKey: encryptSecret(deliveryKey)
  });

  for (const channel of await store.listChannelsForUser(input.ownerUserId)) {
    await store.addChannelMember(channel.id, "agent", agent.id);
  }

  return { agent, secret, deliveryKey };
}

export function getAgentSecret(agent: Agent): string {
  return agent.secret.startsWith("v1:") ? decryptSecret(agent.secret) : agent.secret;
}
