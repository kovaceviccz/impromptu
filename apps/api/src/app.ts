import { fileURLToPath } from "node:url";

import staticFiles from "@fastify/static";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify from "fastify";

import { healthRoutes } from "./health/routes.js";
import type { PrivateLobbyStore } from "./lobbies/store.js";
import type { LiveKitGateway } from "./topics/livekit.js";
import { topicRoutes } from "./topics/routes.js";

type BuildAppOptions = {
  livekit: LiveKitGateway;
  privateLobbies: PrivateLobbyStore;
  livekitPublicUrl: string;
  tokenTtlSeconds: number;
  logger?: boolean;
  serveWeb?: boolean;
};

export async function buildApp(options: BuildAppOptions) {
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

  await app.register(healthRoutes);
  await app.register(topicRoutes, {
    livekit: options.livekit,
    privateLobbies: options.privateLobbies,
    livekitPublicUrl: options.livekitPublicUrl,
    tokenTtlSeconds: options.tokenTtlSeconds,
  });
  app.addHook("onClose", async () => options.privateLobbies.close());

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
