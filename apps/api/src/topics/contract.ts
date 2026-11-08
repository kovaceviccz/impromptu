import { z } from "zod";

import { healthSchema } from "../health/contract.js";
import { lobbyStateSchema } from "../lobbies/contract.js";

export { topicPresets, type TopicPreset } from "./data.js";

export const debateSideSchema = z.union([z.literal(0), z.literal(1)]);
export const debateRoleSchema = z.enum(["debater", "spectator"]);
export const topicVisibilitySchema = z.enum(["public", "private"]);
export const topicCategories = [
  "Philosophy",
  "Society",
  "Sports",
  "Music",
  "Entertainment",
  "Miscellaneous",
] as const;
export type TopicCategory = (typeof topicCategories)[number];
export const topicCategorySchema = z.enum(topicCategories);
export const lobbyTags = [
  "Casual",
  "Serious",
  "Beginner-friendly",
  "Competitive",
  "Educational",
  "Open-minded",
] as const;
export type LobbyTag = (typeof lobbyTags)[number];
export const lobbyTagSchema = z.enum(lobbyTags);
export const lobbyTagsSchema = z
  .array(lobbyTagSchema)
  .max(lobbyTags.length)
  .refine((tags) => new Set(tags).size === tags.length);

export const lobbyParticipantSchema = z.strictObject({
  displayName: z.string().min(1),
  role: debateRoleSchema,
  sideIndex: debateSideSchema.nullable(),
});

export const topicStatusSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  category: topicCategorySchema.optional(),
  tags: lobbyTagsSchema.optional(),
  sideAvailability: z.tuple([z.boolean(), z.boolean()]),
  debaterCount: z.number().int().min(0).max(2),
  spectatorCount: z.number().int().min(0),
  participants: z.array(lobbyParticipantSchema),
});

export const privateLobbyPreviewSchema = topicStatusSchema.extend({
  lobbyId: z.string().min(1),
  state: lobbyStateSchema,
  tags: lobbyTagsSchema.optional(),
});

export const topicsSchema = z.array(topicStatusSchema);

export const publicLobbySchema = z.strictObject({
  lobbyId: z.string().min(1),
  topicId: z.string().min(1),
  name: z.string().min(1),
  topicTitle: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  category: topicCategorySchema.optional(),
  state: lobbyStateSchema,
  tags: lobbyTagsSchema.optional(),
  debaterCount: z.number().int().min(0).max(2),
  spectatorCount: z.number().int().min(0),
  sideAvailability: z.tuple([z.boolean(), z.boolean()]),
});

export const publicLobbiesSchema = z.array(publicLobbySchema);

export const topicParamsSchema = z.strictObject({
  topicId: z.string().min(1),
});

// The lobby ID identifies the same room as its topic ID.
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

export const lobbyCreateBodySchema = z.discriminatedUnion("intent", [
  z.strictObject({
    name: z.string().trim().min(1).max(80),
    sides: z.tuple([
      z.string().trim().min(1).max(120),
      z.string().trim().min(1).max(120),
    ]),
    category: topicCategorySchema,
    tags: lobbyTagsSchema.default([]),
    visibility: topicVisibilitySchema,
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("debater"),
    sideIndex: debateSideSchema,
  }),
  z.strictObject({
    name: z.string().trim().min(1).max(80),
    sides: z.tuple([
      z.string().trim().min(1).max(120),
      z.string().trim().min(1).max(120),
    ]),
    category: topicCategorySchema,
    tags: lobbyTagsSchema.default([]),
    visibility: topicVisibilitySchema,
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("spectator"),
  }),
]);

export const leaveBodySchema = z.strictObject({
  lobbyId: z.string().min(1),
  token: z.string().min(1),
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
  voteEligible: z.boolean().optional(),
  lobbyId: z.string().min(1),
  lobbyName: z.string().min(1).optional(),
  visibility: topicVisibilitySchema.optional(),
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

export const errorSchema = z.strictObject({ message: z.string().min(1) });

export const sideUnavailableErrorSchema = z.strictObject({
  code: z.literal("SIDE_UNAVAILABLE"),
  message: z.string().min(1),
  sideIndex: debateSideSchema,
  topicTitle: z.string().min(1),
});

export const roundAlreadyStartedErrorSchema = z.strictObject({
  code: z.literal("ROUND_ALREADY_STARTED"),
  message: z.string().min(1),
});

export const roomParticipantsRequestSchema = z.strictObject({
  lobbyId: z.string().min(1),
  token: z.string().min(1),
});

export const sendChatMessageBodySchema = roomParticipantsRequestSchema.extend({
  message: z.string().trim().min(1).max(500),
});

export const chatMessageSchema = z.strictObject({
  id: z.string().uuid(),
  message: z.string().min(1).max(500),
  senderIdentity: z.string().min(1),
  senderName: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
});

export const chatModerationErrorSchema = z.strictObject({
  code: z.enum(["DUPLICATE_MESSAGE", "INAPPROPRIATE_LANGUAGE", "RATE_LIMITED"]),
  message: z.string().min(1),
  retryAfterSeconds: z.number().int().positive().optional(),
});

export const startDebateBodySchema = z.strictObject({
  durationSeconds: z.number().int().min(60).max(3600).optional(),
  lobbyId: z.string().min(1),
  token: z.string().min(1),
});

export const startDebateResultSchema = z.strictObject({
  state: lobbyStateSchema,
});

export const roundResultsSchema = z.strictObject({
  debaters: z.tuple([
    z.strictObject({ name: z.string(), votes: z.number().int().nonnegative() }),
    z.strictObject({ name: z.string(), votes: z.number().int().nonnegative() }),
  ]),
  winningSide: z.union([z.literal(0), z.literal(1)]).nullable(),
});
export type RoundResults = z.output<typeof roundResultsSchema>;

export const votingSummarySchema = z.strictObject({
  voteEligible: z.boolean().optional(),
  results: roundResultsSchema.nullable().optional(),
  votingEndsAt: z.string().nullable(),
  voteCounts: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
  selectedVote: z.enum(["0", "1"]).nullable(),
});

export const roomParticipantsResultSchema = z.strictObject({
  ...votingSummarySchema.partial().shape,
  roundEndsAt: z.string().nullable().optional(),
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
  submitVote: {
    method: "POST",
    path: "/api/topics/:topicId/vote",
    params: topicParamsSchema,
    body: z.strictObject({
      lobbyId: z.string().min(1),
      token: z.string().min(1),
      choice: z.enum(["0", "1"]).nullable(),
    }),
    response: votingSummarySchema,
    errors: {
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
    },
  },
  publicLobbies: {
    method: "GET",
    path: "/api/lobbies/public",
    response: publicLobbiesSchema,
  },
  publicLobbyEvents: {
    method: "GET",
    path: "/api/lobbies/public/events",
  },
  createLobby: {
    method: "POST",
    path: "/api/topics",
    body: lobbyCreateBodySchema,
    response: joinResultSchema,
    errors: { 409: errorSchema },
  },
  endRound: {
    method: "POST",
    path: "/api/topics/:topicId/end-round",
    params: topicParamsSchema,
    body: leaveBodySchema,
    response: startDebateResultSchema,
    errors: {
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
    },
  },
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
  sendChatMessage: {
    method: "POST",
    path: "/api/topics/:topicId/chat",
    params: topicParamsSchema,
    body: sendChatMessageBodySchema,
    response: chatMessageSchema,
    errors: {
      400: chatModerationErrorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: chatModerationErrorSchema,
      429: chatModerationErrorSchema,
      503: errorSchema,
    },
  },
  topics: {
    method: "GET",
    path: "/api/topics",
    response: topicsSchema,
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
    errors: {
      404: errorSchema,
      409: z.union([
        sideUnavailableErrorSchema,
        roundAlreadyStartedErrorSchema,
      ]),
    },
  },
  join: {
    method: "POST",
    path: "/api/topics/:topicId/join",
    params: topicParamsSchema,
    body: joinBodySchema,
    response: joinResultSchema,
    errors: {
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: z.union([
        sideUnavailableErrorSchema,
        roundAlreadyStartedErrorSchema,
      ]),
    },
  },
  closeLobby: {
    method: "POST",
    path: "/api/topics/:topicId/close",
    params: topicParamsSchema,
    body: closeLobbyBodySchema,
    response: healthSchema,
    errors: { 401: errorSchema, 403: errorSchema, 404: errorSchema },
  },
  leave: {
    method: "POST",
    path: "/api/topics/:topicId/leave",
    params: topicParamsSchema,
    body: leaveBodySchema,
    response: healthSchema,
    errors: { 401: errorSchema, 404: errorSchema },
  },
} as const;

export type TopicStatus = z.output<typeof topicStatusSchema>;
export type PublicLobby = z.output<typeof publicLobbySchema>;
export type LobbyCreateInput = z.output<typeof lobbyCreateBodySchema>;
export type LobbyParticipant = z.output<typeof lobbyParticipantSchema>;
export type JoinInput = z.output<typeof joinBodySchema>;
export type StartDebateInput = z.output<typeof startDebateBodySchema>;
export type StartDebateResult = z.output<typeof startDebateResultSchema>;
export type PrivateLobbyPreview = z.output<typeof privateLobbyPreviewSchema>;
export type JoinByCodeInput = z.output<typeof joinCodeBodySchema>;
export type JoinResult = z.output<typeof joinResultSchema>;
export type SideUnavailableError = z.output<typeof sideUnavailableErrorSchema>;
export type ChatMessage = z.output<typeof chatMessageSchema>;
export type SendChatMessageInput = z.output<typeof sendChatMessageBodySchema>;
