import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";

import { healthContract } from "./contract.js";

export const healthRoutes: FastifyPluginAsyncZod<{
  checkDatabase?: () => Promise<void>;
}> = async (app, options) => {
  app.get(
    healthContract.path,
    {
      schema: {
        response: {
          200: healthContract.response,
          503: healthContract.unavailable,
        },
      },
    },
    async (_request, reply) => {
      try {
        await options.checkDatabase?.();
        return { status: "ok" as const };
      } catch {
        return reply.code(503).send({ status: "unavailable" as const });
      }
    },
  );
};
