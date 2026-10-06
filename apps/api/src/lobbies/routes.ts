import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";

import { lobbyContracts } from "./contract.js";
import { toPublicLobbySummary, type PublicLobbyRepository } from "./data.js";

export type LobbyRoutesOptions = {
  publicLobbies: PublicLobbyRepository;
};

export const lobbyRoutes: FastifyPluginAsyncZod<LobbyRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    lobbyContracts.publicLobbies.path,
    { schema: { response: { 200: lobbyContracts.publicLobbies.response } } },
    async () => {
      const summaries = (await options.publicLobbies.list()).map(
        toPublicLobbySummary,
      );

      return summaries.sort(
        (a, b) =>
          a.question.localeCompare(b.question) || a.id.localeCompare(b.id),
      );
    },
  );
};
