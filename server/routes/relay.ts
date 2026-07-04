import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RelayHub } from "../relay/relayHub.js";

const enrollSchema = z.object({
  enrollmentToken: z.string().min(8),
  gatewayId: z.string().trim().min(1).max(200)
});

const provisionSchema = z.object({
  gatewayId: z.string().trim().min(1),
  platform: z.string().optional(),
  botId: z.string().optional(),
  routeKeys: z.array(z.string()).optional()
});

export async function registerRelayRoutes(app: FastifyInstance, relayHub: RelayHub): Promise<void> {
  app.post("/relay/enroll", async (request, reply) => {
    const body = enrollSchema.parse(request.body);
    const result = await relayHub.enroll(body.enrollmentToken, body.gatewayId);
    if (!result) {
      reply.code(403);
      return { error: "Enrollment token invalid, expired, or already used." };
    }
    return {
      secret: result.secret,
      deliveryKey: result.deliveryKey,
      tenant: result.tenant,
      gatewayId: result.gatewayId
    };
  });

  app.post("/relay/provision", async (request, reply) => {
    provisionSchema.parse(request.body);
    reply.code(501);
    return { error: "Self-provision is not enabled for this AgentSync deployment. Use enrollment tokens." };
  });

  app.post("/relay/policy", async () => ({ ok: true }));
}
