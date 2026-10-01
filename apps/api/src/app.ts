import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify from "fastify";

import { accountRoutes } from "./accounts/routes.js";
import { createAccountStore } from "./accounts/store.js";
import { healthRoutes } from "./health/routes.js";
import {
  createMemoryPrivateLobbyStore,
  type PrivateLobbyStore,
} from "./lobbies/store.js";
import type { LiveKitGateway } from "./topics/livekit.js";
import { topicRoutes } from "./topics/routes.js";

type BuildAppOptions = {
  database: DatabaseSync;
  livekit: LiveKitGateway;
  privateLobbies?: PrivateLobbyStore;
  livekitPublicUrl: string;
  tokenTtlSeconds: number;
  logger?: boolean;
  secureCookies?: boolean;
  serveWeb?: boolean;
};

export async function buildApp(options: BuildAppOptions) {
  const privateLobbies =
    options.privateLobbies ?? createMemoryPrivateLobbyStore();
  const app = Fastify({
    logger: options.logger ?? false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onRequest", (request, reply, done) => {
    if (request.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store");
    }
    done();
  });

  await app.register(cookie);
  await app.register(healthRoutes);
  await app.register(accountRoutes, {
    accounts: createAccountStore(options.database),
    secureCookies: options.secureCookies ?? false,
  });
  await app.register(topicRoutes, {
    livekit: options.livekit,
    privateLobbies,
    livekitPublicUrl: options.livekitPublicUrl,
    tokenTtlSeconds: options.tokenTtlSeconds,
  });
  app.addHook("onClose", async () => privateLobbies.close());

  if (options.serveWeb) {
    const root = fileURLToPath(
      new URL("../../web/build/client", import.meta.url),
    );
    await app.register(staticFiles, { root });
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      options.serveWeb &&
      request.method === "GET" &&
      !request.url.startsWith("/api/")
    ) {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send({ message: "Not found" });
  });

  return app;
}
