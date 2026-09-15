import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";

import { healthContract } from "./contract.js";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    healthContract.path,
    { schema: { response: { 200: healthContract.response } } },
    async () => ({ status: "ok" as const }),
  );
};
