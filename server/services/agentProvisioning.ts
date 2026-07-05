import { randomSecret } from "../crypto.js";
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
    secret,
    deliveryKey
  });

  for (const channel of await store.listChannelsForUser(input.ownerUserId)) {
    await store.addChannelMember(channel.id, "agent", agent.id);
  }

  return { agent, secret, deliveryKey };
}
