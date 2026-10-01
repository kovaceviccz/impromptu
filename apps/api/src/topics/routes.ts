import { randomUUID } from "node:crypto";

import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";

import { topicContracts } from "./contract.js";
import {
  createPrivateLobby,
  findPrivateLobbyByCode,
} from "../lobbies/codes.js";
import type { PrivateLobbyStore } from "../lobbies/store.js";
import { findTopic, topics } from "./data.js";
import {
  createRoleAllocator,
  type DebateRole,
  type DebateSide,
  type LiveKitGateway,
} from "./livekit.js";
import type { JoinResult } from "./contract.js";

export type TopicRoutesOptions = {
  livekit: LiveKitGateway;
  privateLobbies: PrivateLobbyStore;
  livekitPublicUrl: string;
  tokenTtlSeconds: number;
};

const unavailableMessages = {
  full: "Both debater positions are taken. You can still join as a spectator.",
  taken: "That side was just taken. Choose another side or spectate instead.",
} as const;

function makeJoinResult(input: {
  lobbyId: string;
  topicId: string;
  topicTitle: string;
  sides: [string, string];
  participantIdentity: string;
  displayName: string;
  role: DebateRole;
  sideIndex: DebateSide | null;
  isCreator: boolean;
  joinCode?: string;
  livekitUrl: string;
  token: string;
}): JoinResult {
  return input;
}

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
          const {
            debaterCount,
            participants,
            sideAvailability,
            spectatorCount,
          } = await allocation.status(topic.id);
          return {
            ...topic,
            sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
            sideAvailability: [
              sideAvailability[0],
              sideAvailability[1],
            ] satisfies [boolean, boolean],
            debaterCount,
            spectatorCount,
            participants,
          };
        }),
      ),
  );

  app.post(
    topicContracts.privateLobbyLookup.path,
    {
      schema: {
        body: topicContracts.privateLobbyLookup.body,
        response: {
          200: topicContracts.privateLobbyLookup.response,
          404: topicContracts.privateLobbyLookup.errors[404],
        },
      },
    },
    async (request, reply) => {
      const lobby = await findPrivateLobbyByCode(
        options.privateLobbies,
        request.body.code,
      );
      if (!lobby || (lobby.expiresAt && lobby.expiresAt <= new Date())) {
        return reply.code(404).send({ message: "Private lobby not found" });
      }

      const topic = findTopic(lobby.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const { debaterCount, participants, sideAvailability, spectatorCount } =
        await allocation.status(lobby.id);
      return {
        id: topic.id,
        lobbyId: lobby.id,
        title: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        sideAvailability: [sideAvailability[0], sideAvailability[1]] satisfies [
          boolean,
          boolean,
        ],
        debaterCount,
        spectatorCount,
        participants,
      };
    },
  );

  app.post(
    topicContracts.joinByCode.path,
    {
      schema: {
        body: topicContracts.joinByCode.body,
        response: {
          200: topicContracts.joinByCode.response,
          404: topicContracts.joinByCode.errors[404],
          409: topicContracts.joinByCode.errors[409],
        },
      },
    },
    async (request, reply) => {
      const lobby = await findPrivateLobbyByCode(
        options.privateLobbies,
        request.body.code,
      );
      if (!lobby || (lobby.expiresAt && lobby.expiresAt <= new Date())) {
        return reply.code(404).send({ message: "Private lobby not found" });
      }

      const topic = findTopic(lobby.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const participantIdentity = randomUUID();
      const role = request.body.intent satisfies DebateRole;
      const sideIndex =
        request.body.intent === "debater" ? request.body.sideIndex : null;
      const allocationResult = await allocation.join(
        lobby.id,
        participantIdentity,
        role,
        request.body.displayName,
        sideIndex,
      );

      if ("unavailable" in allocationResult) {
        return reply.code(409).send({
          code: "SIDE_UNAVAILABLE",
          message: unavailableMessages[allocationResult.unavailable],
          sideIndex:
            request.body.intent === "debater" ? request.body.sideIndex : 0,
          topicTitle: topic.title,
        });
      }

      return makeJoinResult({
        lobbyId: lobby.id,
        topicId: topic.id,
        topicTitle: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        participantIdentity,
        displayName: request.body.displayName,
        role,
        sideIndex: allocationResult.sideIndex,
        isCreator: participantIdentity === lobby.creatorIdentity,
        livekitUrl: options.livekitPublicUrl,
        token: allocationResult.token,
      });
    },
  );

  app.post(
    topicContracts.privateTopic.path,
    {
      schema: {
        params: topicContracts.privateTopic.params,
        body: topicContracts.privateTopic.body,
        response: {
          200: topicContracts.privateTopic.response,
          404: topicContracts.privateTopic.errors[404],
          409: topicContracts.privateTopic.errors[409],
        },
      },
    },
    async (request, reply) => {
      const topic = findTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const participantIdentity = randomUUID();
      const lobby = await createPrivateLobby(
        options.privateLobbies,
        topic.id,
        participantIdentity,
      );
      const role = request.body.intent satisfies DebateRole;
      const sideIndex =
        request.body.intent === "debater" ? request.body.sideIndex : null;
      let allocationResult;
      try {
        allocationResult = await allocation.join(
          lobby.id,
          participantIdentity,
          role,
          request.body.displayName,
          sideIndex,
        );
      } catch (error) {
        await options.privateLobbies.delete(lobby.id);
        throw error;
      }

      if ("unavailable" in allocationResult) {
        await options.privateLobbies.delete(lobby.id);
        return reply.code(409).send({
          code: "SIDE_UNAVAILABLE",
          message: unavailableMessages[allocationResult.unavailable],
          sideIndex:
            request.body.intent === "debater" ? request.body.sideIndex : 0,
          topicTitle: topic.title,
        });
      }

      return makeJoinResult({
        lobbyId: lobby.id,
        topicId: topic.id,
        topicTitle: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        participantIdentity,
        displayName: request.body.displayName,
        role,
        sideIndex: allocationResult.sideIndex,
        isCreator: true,
        joinCode: lobby.code,
        livekitUrl: options.livekitPublicUrl,
        token: allocationResult.token,
      });
    },
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

      let lobbyId: string = topic.id;
      if (
        request.body.lobbyId !== undefined &&
        request.body.lobbyId !== topic.id
      ) {
        const privateLobby = await options.privateLobbies.findById(
          request.body.lobbyId,
        );
        if (
          privateLobby?.topicId !== topic.id ||
          (privateLobby.expiresAt && privateLobby.expiresAt <= new Date())
        ) {
          return reply.code(404).send({ message: "Lobby not found" });
        }
        lobbyId = privateLobby.id;
      }

      const participantIdentity = randomUUID();
      const displayName =
        request.body.intent === "debater"
          ? request.body.displayName
          : "Spectator";
      const allocationResult = await allocation.join(
        lobbyId,
        participantIdentity,
        request.body.intent,
        displayName,
        request.body.intent === "debater" ? request.body.sideIndex : null,
      );
      if ("unavailable" in allocationResult) {
        if (request.body.intent === "spectator") {
          throw new Error("Spectator token allocation unexpectedly failed");
        }
        return reply.code(409).send({
          code: "SIDE_UNAVAILABLE",
          message: unavailableMessages[allocationResult.unavailable],
          sideIndex: request.body.sideIndex,
          topicTitle: topic.title,
        });
      }

      return {
        lobbyId,
        topicId: topic.id,
        topicTitle: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        participantIdentity,
        displayName,
        role: request.body.intent,
        sideIndex: allocationResult.sideIndex,
        isCreator: false,
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

      if (request.body.lobbyId !== topic.id) {
        const privateLobby = await options.privateLobbies.findById(
          request.body.lobbyId,
        );
        if (privateLobby?.topicId !== topic.id) {
          return reply.code(404).send({ message: "Lobby not found" });
        }
      }

      await allocation.leave(
        request.body.lobbyId,
        request.body.participantIdentity,
      );
      await options.livekit.removeParticipant(
        `debate-${request.body.lobbyId}`,
        request.body.participantIdentity,
      );
      return { status: "ok" as const };
    },
  );
};
