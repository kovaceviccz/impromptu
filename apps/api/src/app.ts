import httpProxy from "@fastify/http-proxy";
import type { MailDelivery } from "./mail/delivery.js";
import { SESSION_COOKIE } from "./accounts/routes.js";
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
import type { AccountStore } from "./accounts/store.js";
import { ChatPolicy } from "./chat/policy.js";
import { healthRoutes } from "./health/routes.js";
import type { PrivateLobbyStore } from "./lobbies/store.js";
import {
  createMemoryPublicLobbyStateStore,
  type PublicLobbyStateStore,
} from "./lobbies/public-state.js";
import type { LiveKitGateway } from "./topics/livekit.js";
import { topicRoutes } from "./topics/routes.js";
import {
  createMemoryDebateResultStore,
  type DebateResultStore,
} from "./statistics/store.js";

type BuildAppOptions = {
  invitationSecret?: string;
  mail?: MailDelivery;
  publicOrigin?: string;
  mailpitUrl?: string;
  mailboxAccountIds?: string[];
  accounts: AccountStore;
  livekit: LiveKitGateway;
  privateLobbies: PrivateLobbyStore;
  publicLobbyState?: PublicLobbyStateStore;
  livekitPublicUrl: string;
  tokenTtlSeconds: number;
  logger?: boolean;
  secureCookies?: boolean;
  serveWeb?: boolean;
  chatPolicy?: ChatPolicy;
  debateResults?: DebateResultStore;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
  }).withTypeProvider<ZodTypeProvider>();
  const publicLobbyState =
    options.publicLobbyState ?? createMemoryPublicLobbyStateStore();
  const debateResults =
    options.debateResults ?? createMemoryDebateResultStore();

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
    accounts: options.accounts,
    debateResults,
    secureCookies: options.secureCookies ?? false,
    mail: options.mail,
    publicOrigin: options.publicOrigin,
    mailboxAccountIds: options.mailboxAccountIds,
  });
  await app.register(topicRoutes, {
    invitationSecret: options.invitationSecret,
    mail: options.mail,
    publicOrigin: options.publicOrigin,
    accounts: options.accounts,
    debateResults,
    livekit: options.livekit,
    privateLobbies: options.privateLobbies,
    publicLobbyState,
    livekitPublicUrl: options.livekitPublicUrl,
    tokenTtlSeconds: options.tokenTtlSeconds,
    chatPolicy: options.chatPolicy ?? new ChatPolicy(),
  });
  app.addHook("onClose", async () => options.privateLobbies.close());
  app.addHook("onClose", async () => publicLobbyState.close());

  if (options.mailpitUrl) {
    await app.register(httpProxy, {
      upstream: options.mailpitUrl,
      prefix: "/mail",
      rewritePrefix: "/mail",
      websocket: true,
      wsClientOptions: {
        rewriteRequestHeaders: () => ({ origin: options.mailpitUrl }),
      },
      preHandler: async (request, reply) => {
        const origin = request.headers.origin;
        if (
          origin &&
          (!URL.canParse(origin) ||
            new URL(origin).host !== request.headers.host)
        )
          return reply.code(403).send({
            message: "Mailbox requests must use the application origin.",
          });
        const token = request.cookies[SESSION_COOKIE];
        const account = token
          ? await options.accounts.findSessionAccount(token)
          : undefined;
        if (!account || !options.mailboxAccountIds?.includes(account.id))
          return reply.code(403).send({ message: "Mailbox access required." });
        return undefined;
      },
      replyOptions: {
        rewriteRequestHeaders: (_request, headers) => {
          const {
            cookie: _cookie,
            authorization: _authorization,
            ...rest
          } = headers;
          return {
            ...rest,
            ...(headers.origin ? { origin: options.mailpitUrl } : {}),
          };
        },
      },
    });
  }
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
