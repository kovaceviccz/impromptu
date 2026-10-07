import { z } from "zod";

import { healthSchema } from "../health/contract.js";
import { lobbyStateSchema } from "../lobbies/contract.js";

export const debateSideSchema = z.union([z.literal(0), z.literal(1)]);
export const debateRoleSchema = z.enum(["debater", "spectator"]);
export const topicVisibilitySchema = z.enum(["public", "private"]);

export const lobbyParticipantSchema = z.strictObject({
  displayName: z.string().min(1),
  role: debateRoleSchema,
  sideIndex: debateSideSchema.nullable(),
});

export const topicStatusSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  sideAvailability: z.tuple([z.boolean(), z.boolean()]),
  debaterCount: z.number().int().min(0).max(2),
  spectatorCount: z.number().int().min(0),
  participants: z.array(lobbyParticipantSchema),
});

export const privateLobbyPreviewSchema = topicStatusSchema.extend({
  lobbyId: z.string().min(1),
  state: lobbyStateSchema,
});

export const privateTopicStatusSchema = topicStatusSchema.extend({
  visibility: topicVisibilitySchema,
  joinCode: z.string().min(1).optional(),
  shareUrl: z.string().min(1).optional(),
});

export const topicsSchema = z.array(topicStatusSchema);

export const topicParamsSchema = z.strictObject({
  topicId: z.string().min(1),
});

// lobbyId selects a private lobby of this topic, used when a participant
// changes role from inside it; without one, the public lobby is joined.
const joinLobbySchema = z.string().min(1).optional();

export const joinBodySchema = z.discriminatedUnion("intent", [
  z.strictObject({
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("debater"),
    lobbyId: joinLobbySchema,
    previousToken: z.string().min(1).optional(),
    sideIndex: debateSideSchema,
  }),
  z.strictObject({
    intent: z.literal("spectator"),
    lobbyId: joinLobbySchema,
    previousToken: z.string().min(1).optional(),
  }),
]);

export const privateLobbyCreateBodySchema = z.discriminatedUnion("intent", [
  z.strictObject({
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("debater"),
    sideIndex: debateSideSchema,
  }),
  z.strictObject({
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("spectator"),
  }),
]);

export const leaveBodySchema = z.strictObject({
  lobbyId: z.string().min(1),
  participantIdentity: z.string().uuid(),
});

export const closeLobbyBodySchema = leaveBodySchema;

export const privateLobbyLookupBodySchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(6)
    .max(8)
    .regex(/^[A-Z0-9]+$/),
});

export const joinCodeBodySchema = z.discriminatedUnion("intent", [
  z.strictObject({
    code: z
      .string()
      .trim()
      .min(6)
      .max(8)
      .regex(/^[A-Z0-9]+$/),
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("debater"),
    sideIndex: debateSideSchema,
  }),
  z.strictObject({
    code: z
      .string()
      .trim()
      .min(6)
      .max(8)
      .regex(/^[A-Z0-9]+$/),
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("spectator"),
  }),
]);

export const joinResultSchema = z.strictObject({
  lobbyId: z.string().min(1),
  state: lobbyStateSchema,
  topicId: z.string().min(1),
  topicTitle: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  participantIdentity: z.string().uuid(),
  displayName: z.string().min(1).max(40),
  role: debateRoleSchema,
  sideIndex: debateSideSchema.nullable(),
  isCreator: z.boolean(),
  hostIdentity: z.string().min(1).nullable(),
  joinCode: z.string().min(1).optional(),
  livekitUrl: z.string().min(1),
  token: z.string().min(1),
});

export const privateTopicCreateResultSchema = joinResultSchema;

export const errorSchema = z.strictObject({ message: z.string().min(1) });

export const sideUnavailableErrorSchema = z.strictObject({
  code: z.literal("SIDE_UNAVAILABLE"),
  message: z.string().min(1),
  sideIndex: debateSideSchema,
  topicTitle: z.string().min(1),
});

export const roomParticipantsRequestSchema = z.strictObject({
  lobbyId: z.string().min(1),
  token: z.string().min(1),
});

export const startDebateBodySchema = z.strictObject({
  lobbyId: z.string().min(1),
  token: z.string().min(1),
});

export const startDebateResultSchema = z.strictObject({
  state: lobbyStateSchema,
});

export const roomParticipantsResultSchema = z.strictObject({
  hostIdentity: z.string().nullable(),
  state: lobbyStateSchema,
  participants: z.array(
    z.strictObject({
      identity: z.string().min(1),
      displayName: z.string().min(1),
      role: debateRoleSchema,
      sideIndex: debateSideSchema.nullable(),
    }),
  ),
});

export const topicContracts = {
  startDebate: {
    method: "POST",
    path: "/api/topics/:topicId/start",
    params: topicParamsSchema,
    body: startDebateBodySchema,
    response: startDebateResultSchema,
    errors: {
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
      503: errorSchema,
    },
  },
  roomParticipants: {
    method: "POST",
    path: "/api/topics/:topicId/participants",
    params: topicParamsSchema,
    body: roomParticipantsRequestSchema,
    response: roomParticipantsResultSchema,
    errors: { 401: errorSchema, 404: errorSchema, 503: errorSchema },
  },
  topics: {
    method: "GET",
    path: "/api/topics",
    response: topicsSchema,
  },
  privateTopic: {
    method: "POST",
    path: "/api/topics/:topicId/private",
    params: topicParamsSchema,
    body: privateLobbyCreateBodySchema,
    response: privateTopicCreateResultSchema,
    errors: { 404: errorSchema, 409: sideUnavailableErrorSchema },
  },
  privateLobbyLookup: {
    method: "POST",
    path: "/api/topics/private/lookup",
    body: privateLobbyLookupBodySchema,
    response: privateLobbyPreviewSchema,
    errors: { 404: errorSchema },
  },
  joinByCode: {
    method: "POST",
    path: "/api/topics/join-code",
    body: joinCodeBodySchema,
    response: joinResultSchema,
    errors: { 404: errorSchema, 409: sideUnavailableErrorSchema },
  },
  join: {
    method: "POST",
    path: "/api/topics/:topicId/join",
    params: topicParamsSchema,
    body: joinBodySchema,
    response: joinResultSchema,
    errors: {
      401: errorSchema,
      404: errorSchema,
      409: sideUnavailableErrorSchema,
    },
  },
  closeLobby: {
    method: "POST",
    path: "/api/topics/:topicId/close",
    params: topicParamsSchema,
    body: closeLobbyBodySchema,
    response: healthSchema,
    errors: { 403: errorSchema, 404: errorSchema },
  },
  leave: {
    method: "POST",
    path: "/api/topics/:topicId/leave",
    params: topicParamsSchema,
    body: leaveBodySchema,
    response: healthSchema,
    errors: { 404: errorSchema },
  },
} as const;

export type TopicStatus = z.output<typeof topicStatusSchema>;
export type LobbyParticipant = z.output<typeof lobbyParticipantSchema>;
export type JoinInput = z.output<typeof joinBodySchema>;
export type StartDebateInput = z.output<typeof startDebateBodySchema>;
export type StartDebateResult = z.output<typeof startDebateResultSchema>;
export type PrivateLobbyCreateInput = z.output<
  typeof privateLobbyCreateBodySchema
>;
export type PrivateLobbyPreview = z.output<typeof privateLobbyPreviewSchema>;
export type JoinByCodeInput = z.output<typeof joinCodeBodySchema>;
export type JoinResult = z.output<typeof joinResultSchema>;
export type SideUnavailableError = z.output<typeof sideUnavailableErrorSchema>;
