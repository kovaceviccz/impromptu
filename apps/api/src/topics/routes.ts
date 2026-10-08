import { randomUUID } from "node:crypto";

import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { UniqueConstraintViolationException } from "@mikro-orm/core";

import { topicContracts } from "./contract.js";
import { createTopicLobby, findPrivateLobbyByCode } from "../lobbies/codes.js";
import {
  DuplicateTopicNameError,
  type PrivateLobbyRecord,
  type PrivateLobbyStore,
} from "../lobbies/store.js";
import type { PublicLobbyStateStore } from "../lobbies/public-state.js";
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
  publicLobbyState: PublicLobbyStateStore;
  livekitPublicUrl: string;
  tokenTtlSeconds: number;
};

type ResolvedTopic = {
  id: string;
  title: string;
  sides: [string, string];
  record?: PrivateLobbyRecord;
};

const unavailableMessages = {
  full: "Both debater positions are taken. You can still join as a spectator.",
  taken: "That side was just taken. Choose another side or spectate instead.",
} as const;

function makeJoinResult(input: {
  lobbyId: string;
  state: JoinResult["state"];
  topicId: string;
  topicTitle: string;
  sides: [string, string];
  participantIdentity: string;
  displayName: string;
  role: DebateRole;
  sideIndex: DebateSide | null;
  isCreator: boolean;
  hostIdentity: string | null;
  lobbyName?: string;
  visibility?: "public" | "private";
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
  async function resolveTopic(id: string): Promise<ResolvedTopic | undefined> {
    const starter = findTopic(id);
    if (starter)
      return {
        id: starter.id,
        title: starter.title,
        sides: [starter.sides[0], starter.sides[1]],
      };
    const record = await options.privateLobbies.findById(id);
    if (
      record?.topicId !== id ||
      !record.name ||
      !record.side0 ||
      !record.side1 ||
      (record.expiresAt && record.expiresAt <= new Date())
    )
      return undefined;
    return {
      id,
      title: record.name,
      sides: [record.side0, record.side1],
      record,
    };
  }
  async function publicTopics(): Promise<ResolvedTopic[]> {
    const created = await options.privateLobbies.listPublic();
    return [
      ...topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        sides: [topic.sides[0], topic.sides[1]] as [string, string],
      })),
      ...created
        .filter(
          (record) =>
            record.topicId === record.id &&
            record.name &&
            record.side0 &&
            record.side1 &&
            (!record.expiresAt || record.expiresAt > new Date()),
        )
        .map((record) => ({
          id: record.id,
          title: record.name!,
          sides: [record.side0!, record.side1!] as [string, string],
          record,
        })),
    ];
  }
  const publicListeners = new Set<import("node:http").ServerResponse>();
  let publicRevision = 0;
  function publishPublicChange() {
    publicRevision += 1;
    for (const response of publicListeners) {
      response.write(`event: changed\ndata: ${publicRevision}\n\n`);
    }
  }
  const countRefresh = setInterval(() => {
    if (publicListeners.size > 0) publishPublicChange();
  }, 3000);
  countRefresh.unref();
  app.addHook("onClose", async () => {
    clearInterval(countRefresh);
    for (const response of publicListeners) response.end();
    publicListeners.clear();
  });

  app.get(topicContracts.publicLobbyEvents.path, async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });
    reply.raw.write(`event: changed\ndata: ${publicRevision}\n\n`);
    publicListeners.add(reply.raw);
    reply.raw.on("close", () => publicListeners.delete(reply.raw));
  });

  app.get(
    topicContracts.publicLobbies.path,
    { schema: { response: { 200: topicContracts.publicLobbies.response } } },
    async () => {
      return Promise.all(
        (await publicTopics()).map(async (topic) => {
          const status = await allocation.status(topic.id);
          const state =
            topic.record?.state ??
            (await options.publicLobbyState.find(topic.id))?.state ??
            "WAITING";
          return {
            lobbyId: topic.id,
            topicId: topic.id,
            name: topic.title,
            topicTitle: topic.title,
            sides: [topic.sides[0], topic.sides[1]] as [string, string],
            state,
            debaterCount: status.debaterCount,
            spectatorCount: status.spectatorCount,
            sideAvailability: [
              state === "WAITING" && status.sideAvailability[0],
              state === "WAITING" && status.sideAvailability[1],
            ] as [boolean, boolean],
          };
        }),
      );
    },
  );

  async function publishDebateStarted(lobbyId: string) {
    try {
      await options.livekit.updateRoomMetadata(
        `debate-${lobbyId}`,
        "DEBATE_IN_PROGRESS",
      );
      return true;
    } catch (cause) {
      app.log.error(
        { err: cause, lobbyId },
        "Could not broadcast the debate start to lobby participants",
      );
      return false;
    }
  }

  app.post(
    topicContracts.startDebate.path,
    {
      schema: {
        params: topicContracts.startDebate.params,
        body: topicContracts.startDebate.body,
        response: {
          200: topicContracts.startDebate.response,
          401: topicContracts.startDebate.errors[401],
          403: topicContracts.startDebate.errors[403],
          404: topicContracts.startDebate.errors[404],
          409: topicContracts.startDebate.errors[409],
          503: topicContracts.startDebate.errors[503],
        },
      },
    },
    async (request, reply) => {
      const topic = await resolveTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const { lobbyId, token } = request.body;
      const identity = await options.livekit.verifyParticipantToken(
        token,
        `debate-${lobbyId}`,
      );
      if (!identity) {
        return reply.code(401).send({
          message: "Your room session expired. Rejoin the lobby.",
        });
      }

      const isPublicLobby = !topic.record && lobbyId === topic.id;
      let hostIdentity: string | null;
      let state: JoinResult["state"];
      if (isPublicLobby) {
        const lobby = await options.publicLobbyState.find(topic.id);
        if (!lobby) {
          return reply.code(403).send({
            message: "Only the public lobby host can start the debate.",
          });
        }
        hostIdentity = lobby.hostIdentity;
        state = lobby.state;
      } else {
        const lobby = await options.privateLobbies.findById(lobbyId);
        if (
          !lobby ||
          lobby.topicId !== topic.id ||
          (lobby.expiresAt && lobby.expiresAt <= new Date())
        ) {
          return reply.code(404).send({ message: "Lobby not found" });
        }
        hostIdentity = lobby.creatorIdentity;
        state = lobby.state;
      }

      if (identity !== hostIdentity) {
        return reply.code(403).send({
          message: isPublicLobby
            ? "Only the public lobby host can start the debate."
            : "Only the private lobby creator can start the debate.",
        });
      }

      if (state === "DEBATE_IN_PROGRESS") {
        if (!(await publishDebateStarted(lobbyId))) {
          return reply.code(503).send({
            message:
              "The debate started, but its status could not be shared with everyone. Please retry.",
          });
        }
        return { state };
      }
      if (state !== "WAITING") {
        return reply.code(409).send({
          message: "This lobby can no longer be started.",
        });
      }

      const participants = await options.livekit.listParticipants(
        `debate-${lobbyId}`,
      );
      const debaterSides = new Set(
        participants
          .filter(
            (participant) =>
              participant.role === "debater" && participant.sideIndex !== null,
          )
          .map((participant) => participant.sideIndex),
      );
      const hasSpectator = participants.some(
        (participant) => participant.role === "spectator",
      );
      if (
        !participants.some(
          (participant) => participant.identity === identity,
        ) ||
        debaterSides.size !== 2 ||
        !debaterSides.has(0) ||
        !debaterSides.has(1) ||
        !hasSpectator
      ) {
        return reply.code(409).send({
          message:
            "Both debater positions and at least one spectator must be in the lobby to start.",
        });
      }

      const updated = isPublicLobby
        ? await options.publicLobbyState.updateState(
            topic.id,
            "WAITING",
            "DEBATE_IN_PROGRESS",
          )
        : await options.privateLobbies.updateState(
            lobbyId,
            "WAITING",
            "DEBATE_IN_PROGRESS",
          );
      if (!updated) {
        const latestState = isPublicLobby
          ? (await options.publicLobbyState.find(topic.id))?.state
          : (await options.privateLobbies.findById(lobbyId))?.state;
        if (latestState === "DEBATE_IN_PROGRESS") {
          if (!(await publishDebateStarted(lobbyId))) {
            return reply.code(503).send({
              message:
                "The debate started, but its status could not be shared with everyone. Please retry.",
            });
          }
          return { state: latestState };
        }
        return reply.code(409).send({
          message: "This lobby can no longer be started.",
        });
      }

      if (!(await publishDebateStarted(lobbyId))) {
        return reply.code(503).send({
          message:
            "The debate started, but its status could not be shared with everyone. Please retry.",
        });
      }

      if (!isPublicLobby) {
        const startedLobby = await options.privateLobbies.findById(lobbyId);
        if (startedLobby?.visibility === "public") publishPublicChange();
      } else {
        publishPublicChange();
      }

      return { state: "DEBATE_IN_PROGRESS" as const };
    },
  );

  app.get(
    topicContracts.topics.path,
    { schema: { response: { 200: topicContracts.topics.response } } },
    async () =>
      Promise.all(
        (await publicTopics()).map(async (topic) => {
          const {
            debaterCount,
            participants,
            sideAvailability,
            spectatorCount,
          } = await allocation.status(topic.id);
          const state =
            topic.record?.state ??
            (await options.publicLobbyState.find(topic.id))?.state ??
            "WAITING";
          const canDebate = state === "WAITING";
          return {
            id: topic.id,
            title: topic.title,
            sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
            sideAvailability: [
              canDebate && sideAvailability[0],
              canDebate && sideAvailability[1],
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
      if (
        !lobby ||
        lobby.visibility === "public" ||
        (lobby.expiresAt && lobby.expiresAt <= new Date())
      ) {
        return reply.code(404).send({ message: "Private lobby not found" });
      }

      const topic = await resolveTopic(lobby.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const { debaterCount, participants, sideAvailability, spectatorCount } =
        await allocation.status(lobby.id);
      const canDebate = lobby.state === "WAITING";
      return {
        id: topic.id,
        lobbyId: lobby.id,
        state: lobby.state,
        title: lobby.name ?? topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        sideAvailability: [
          canDebate && sideAvailability[0],
          canDebate && sideAvailability[1],
        ] satisfies [boolean, boolean],
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
      if (
        !lobby ||
        lobby.visibility === "public" ||
        (lobby.expiresAt && lobby.expiresAt <= new Date())
      ) {
        return reply.code(404).send({ message: "Private lobby not found" });
      }

      const topic = await resolveTopic(lobby.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      if (lobby.state !== "WAITING" && request.body.intent === "debater") {
        return reply.code(409).send({
          code: "ROUND_ALREADY_STARTED",
          message: "Positions cannot change after the debate starts.",
        });
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
        lobbyName: lobby.name,
        visibility: "private",
        state: lobby.state,
        topicId: topic.id,
        topicTitle: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        participantIdentity,
        displayName: request.body.displayName,
        role,
        sideIndex: allocationResult.sideIndex,
        isCreator: participantIdentity === lobby.creatorIdentity,
        hostIdentity: lobby.creatorIdentity,
        livekitUrl: options.livekitPublicUrl,
        token: allocationResult.token,
      });
    },
  );

  app.post(
    topicContracts.createLobby.path,
    {
      schema: {
        body: topicContracts.createLobby.body,
        response: {
          200: topicContracts.createLobby.response,
          409: topicContracts.createLobby.errors[409],
        },
      },
    },
    async (request, reply) => {
      const identity = randomUUID();
      const { name, sides, visibility, displayName, intent } = request.body;
      if (
        topics.some(
          (topic) => topic.title.toLowerCase() === name.toLowerCase(),
        ) ||
        (await options.privateLobbies.hasCreatedName(name))
      ) {
        return reply.code(409).send({ message: "This topic already exists." });
      }
      let lobby;
      try {
        lobby = await createTopicLobby(options.privateLobbies, {
          name,
          sides,
          visibility,
          creatorIdentity: identity,
        });
      } catch (error) {
        if (
          error instanceof DuplicateTopicNameError ||
          error instanceof UniqueConstraintViolationException
        )
          return reply
            .code(409)
            .send({ message: "This topic already exists." });
        throw error;
      }
      const sideIndex = intent === "debater" ? request.body.sideIndex : null;
      let allocationResult;
      try {
        allocationResult = await allocation.join(
          lobby.id,
          identity,
          intent,
          displayName,
          sideIndex,
        );
      } catch (error) {
        await options.privateLobbies.delete(lobby.id);
        throw error;
      }
      if ("unavailable" in allocationResult) {
        await options.privateLobbies.delete(lobby.id);
        throw new Error("New topic side unexpectedly unavailable");
      }
      if (visibility === "public") publishPublicChange();

      return makeJoinResult({
        lobbyId: lobby.id,
        lobbyName: name,
        visibility,
        state: lobby.state,
        topicId: lobby.topicId,
        topicTitle: name,
        sides,
        participantIdentity: identity,
        displayName,
        role: intent,
        sideIndex: allocationResult.sideIndex,
        isCreator: true,
        hostIdentity: identity,
        joinCode:
          "code" in lobby && typeof lobby.code === "string"
            ? lobby.code
            : undefined,
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
          401: topicContracts.join.errors[401],
          403: topicContracts.join.errors[403],
          404: topicContracts.join.errors[404],
          409: topicContracts.join.errors[409],
        },
      },
    },
    async (request, reply) => {
      const topic = await resolveTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      let lobbyId: string = topic.id;
      let state: JoinResult["state"] = "WAITING";
      let hostIdentity: string | null = null;
      let lobbyName: string | undefined;
      let joinedVisibility: "public" | "private" | undefined;
      if (
        topic.record ||
        (request.body.lobbyId !== undefined &&
          request.body.lobbyId !== topic.id)
      ) {
        const privateLobby =
          topic.record ??
          (await options.privateLobbies.findById(request.body.lobbyId!));
        if (
          privateLobby?.topicId !== topic.id ||
          (topic.record &&
            request.body.lobbyId !== undefined &&
            request.body.lobbyId !== topic.id) ||
          (privateLobby.expiresAt && privateLobby.expiresAt <= new Date())
        ) {
          return reply.code(404).send({ message: "Lobby not found" });
        }
        if (
          privateLobby.visibility !== "public" &&
          !request.body.previousToken
        ) {
          return reply.code(403).send({
            message: "Join this private lobby with its code.",
          });
        }
        lobbyId = privateLobby.id;
        state = privateLobby.state;
        hostIdentity = privateLobby.creatorIdentity;
        lobbyName = privateLobby.name;
        joinedVisibility = privateLobby.visibility ?? "private";
      } else {
        state =
          (await options.publicLobbyState.find(topic.id))?.state ?? "WAITING";
      }

      let participantIdentity: string = randomUUID();
      if (request.body.previousToken) {
        const verifiedIdentity = await options.livekit.verifyParticipantToken(
          request.body.previousToken,
          `debate-${lobbyId}`,
        );
        if (!verifiedIdentity) {
          return reply.code(401).send({
            message:
              "Your room session expired. Rejoin the lobby to change roles.",
          });
        }
        participantIdentity = verifiedIdentity;
      }
      if (
        state !== "WAITING" &&
        (request.body.previousToken || request.body.intent === "debater")
      ) {
        return reply.code(409).send({
          code: "ROUND_ALREADY_STARTED",
          message: "Positions cannot change after the debate starts.",
        });
      }
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
        request.body.previousToken ? participantIdentity : undefined,
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

      if (!topic.record && lobbyId === topic.id) {
        try {
          const publicLobby = await options.publicLobbyState.claimHost(
            topic.id,
            participantIdentity,
          );
          state = publicLobby.state;
          hostIdentity = publicLobby.hostIdentity;
        } catch (cause) {
          await allocation.leave(lobbyId, participantIdentity);
          throw cause;
        }
      }
      if (
        (!topic.record && lobbyId === topic.id) ||
        joinedVisibility === "public"
      )
        publishPublicChange();

      return {
        lobbyId,
        lobbyName,
        visibility: joinedVisibility ?? "public",
        state,
        topicId: topic.id,
        topicTitle: topic.title,
        sides: [topic.sides[0], topic.sides[1]] satisfies [string, string],
        participantIdentity,
        displayName,
        role: request.body.intent,
        sideIndex: allocationResult.sideIndex,
        isCreator: participantIdentity === hostIdentity,
        hostIdentity,
        livekitUrl: options.livekitPublicUrl,
        token: allocationResult.token,
      };
    },
  );

  app.post(
    topicContracts.roomParticipants.path,
    {
      schema: {
        params: topicContracts.roomParticipants.params,
        body: topicContracts.roomParticipants.body,
        response: {
          200: topicContracts.roomParticipants.response,
          401: topicContracts.roomParticipants.errors[401],
          404: topicContracts.roomParticipants.errors[404],
          503: topicContracts.roomParticipants.errors[503],
        },
      },
    },
    async (request, reply) => {
      const topic = await resolveTopic(request.params.topicId);
      if (!topic) return reply.code(404).send({ message: "Topic not found" });
      const { lobbyId, token } = request.body;
      const identity = await options.livekit.verifyParticipantToken(
        token,
        `debate-${lobbyId}`,
      );
      if (!identity)
        return reply
          .code(401)
          .send({ message: "Your room session expired. Rejoin the lobby." });
      let hostIdentity: string | null = null;
      let state: JoinResult["state"] = "WAITING";
      if (topic.record || lobbyId !== topic.id) {
        const lobby =
          topic.record ?? (await options.privateLobbies.findById(lobbyId));
        if (
          lobby?.topicId !== topic.id ||
          (topic.record && lobbyId !== topic.id) ||
          (lobby.expiresAt && lobby.expiresAt <= new Date())
        ) {
          return reply.code(404).send({ message: "Lobby not found" });
        }
        hostIdentity = lobby.creatorIdentity;
        state = lobby.state;
      } else {
        const lobby = await options.publicLobbyState.find(topic.id);
        hostIdentity = lobby?.hostIdentity ?? null;
        state = lobby?.state ?? "WAITING";
      }
      try {
        const participants = await options.livekit.listParticipants(
          `debate-${lobbyId}`,
        );
        return {
          hostIdentity,
          state,
          participants: [
            ...new Map(
              participants.map((participant) => [
                participant.identity,
                participant,
              ]),
            ).values(),
          ],
        };
      } catch {
        return reply.code(503).send({
          message:
            "Participants could not be loaded. Your room connection is still available. Try again.",
        });
      }
    },
  );

  app.post(
    topicContracts.closeLobby.path,
    {
      schema: {
        params: topicContracts.closeLobby.params,
        body: topicContracts.closeLobby.body,
        response: {
          200: topicContracts.closeLobby.response,
          401: topicContracts.closeLobby.errors[401],
          403: topicContracts.closeLobby.errors[403],
          404: topicContracts.closeLobby.errors[404],
        },
      },
    },
    async (request, reply) => {
      const topic = await resolveTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const identity = await options.livekit.verifyParticipantToken(
        request.body.token,
        `debate-${request.body.lobbyId}`,
      );
      if (!identity) {
        return reply.code(401).send({ message: "Your room session expired." });
      }

      const privateLobby = await options.privateLobbies.findById(
        request.body.lobbyId,
      );
      if (!privateLobby || privateLobby.topicId !== topic.id) {
        return reply.code(404).send({ message: "Lobby not found" });
      }
      if (privateLobby.creatorIdentity !== identity) {
        return reply.code(403).send({
          message: "Only the lobby creator can close it.",
        });
      }

      const participants = await options.livekit.listParticipants(
        `debate-${request.body.lobbyId}`,
      );
      await Promise.all(
        participants.map(async (participant) => {
          await allocation.leave(request.body.lobbyId, participant.identity);
          await options.livekit.removeParticipant(
            `debate-${request.body.lobbyId}`,
            participant.identity,
          );
        }),
      );
      await options.privateLobbies.delete(request.body.lobbyId);
      if (privateLobby.visibility === "public") publishPublicChange();
      return { status: "ok" as const };
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
          401: topicContracts.leave.errors[401],
          404: topicContracts.leave.errors[404],
        },
      },
    },
    async (request, reply) => {
      const topic = await resolveTopic(request.params.topicId);
      if (!topic) {
        return reply.code(404).send({ message: "Topic not found" });
      }

      const identity = await options.livekit.verifyParticipantToken(
        request.body.token,
        `debate-${request.body.lobbyId}`,
      );
      if (!identity) {
        return reply.code(401).send({ message: "Your room session expired." });
      }

      if (topic.record || request.body.lobbyId !== topic.id) {
        const privateLobby = await options.privateLobbies.findById(
          request.body.lobbyId,
        );
        if (privateLobby?.topicId !== topic.id) {
          return reply.code(404).send({ message: "Lobby not found" });
        }
      }

      await allocation.leave(request.body.lobbyId, identity);
      await options.livekit.removeParticipant(
        `debate-${request.body.lobbyId}`,
        identity,
      );
      if (topic.record || request.body.lobbyId !== topic.id) {
        const lobby = await options.privateLobbies.findById(
          request.body.lobbyId,
        );
        if (lobby?.visibility === "public") publishPublicChange();
      }
      if (!topic.record && request.body.lobbyId === topic.id) {
        const publicLobby = await options.publicLobbyState.find(topic.id);
        if (publicLobby?.hostIdentity === identity) {
          const remaining = await options.livekit.listParticipants(
            `debate-${topic.id}`,
          );
          await options.publicLobbyState.updateHost(
            topic.id,
            identity,
            remaining[0]?.identity ?? null,
          );
        }
        publishPublicChange();
      }
      return { status: "ok" as const };
    },
  );
};
