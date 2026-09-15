import { randomUUID } from "node:crypto";

import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";

import { topicContracts } from "./contract.js";
import { findTopic, topics } from "./data.js";
import { createRoleAllocator, type LiveKitGateway } from "./livekit.js";

export type TopicRoutesOptions = {
  livekit: LiveKitGateway;
  livekitPublicUrl: string;
  tokenTtlSeconds: number;
};

export const topicRoutes: FastifyPluginAsyncZod<TopicRoutesOptions> = async (
  app,
  options,
) => {
  const allocation = createRoleAllocator(
    options.livekit,
    options.tokenTtlSeconds,
  );

  app.get(
    topicContracts.topics.path,
    { schema: { response: { 200: topicContracts.topics.response } } },
    async () =>
      Promise.all(
        topics.map(async (topic) => {
          const { debaterCount, sideAvailability, spectatorCount } =
            await allocation.status(topic.id);
          return {
            ...topic,
            sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
            sideAvailability: [
              sideAvailability[0],
              sideAvailability[1],
            ] satisfies [boolean, boolean],
            debaterCount,
            spectatorCount,
          };
        }),
      ),
  );

  app.post(
    topicContracts.join.path,
    {
      schema: {
        params: topicContracts.join.params,
        body: topicContracts.join.body,
        response: {
          200: topicContracts.join.response,
          404: topicContracts.join.errors[404],
          409: topicContracts.join.errors[409],
        },
      },
    },
    async (request, reply) => {
      const topic = findTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const participantIdentity = randomUUID();
      const displayName =
        request.body.intent === "debater"
          ? request.body.displayName
          : "Spectator";
      const allocationResult = await allocation.join(
        topic.id,
        participantIdentity,
        request.body.intent,
        displayName,
        request.body.intent === "debater" ? request.body.sideIndex : null,
      );
      if (allocationResult === undefined) {
        if (request.body.intent === "spectator") {
          throw new Error("Spectator token allocation unexpectedly failed");
        }
        return reply.code(409).send({
          code: "SIDE_UNAVAILABLE",
          message:
            "That side was just taken. Choose another side or spectate instead.",
          sideIndex: request.body.sideIndex,
          topicTitle: topic.title,
        });
      }

      return {
        topicId: topic.id,
        topicTitle: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        participantIdentity,
        displayName,
        role: request.body.intent,
        sideIndex: allocationResult.sideIndex,
        livekitUrl: options.livekitPublicUrl,
        token: allocationResult.token,
      };
    },
  );

  app.post(
    topicContracts.leave.path,
    {
      schema: {
        params: topicContracts.leave.params,
        body: topicContracts.leave.body,
        response: {
          200: topicContracts.leave.response,
          404: topicContracts.leave.errors[404],
        },
      },
    },
    async (request, reply) => {
      const topic = findTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      await allocation.leave(topic.id, request.body.participantIdentity);
      return { status: "ok" as const };
    },
  );
};
