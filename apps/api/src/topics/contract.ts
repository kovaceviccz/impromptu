import { z } from "zod";

import { healthSchema } from "../health/contract.js";

export const debateSideSchema = z.union([z.literal(0), z.literal(1)]);
export const topicVisibilitySchema = z.enum(["public", "private"]);
export const debateRoleSchema = z.enum(["debater", "spectator"]);

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

export const joinBodySchema = z.discriminatedUnion("intent", [
  z.strictObject({
    displayName: z.string().trim().min(1).max(40),
    intent: z.literal("debater"),
    sideIndex: debateSideSchema,
  }),
  z.strictObject({ intent: z.literal("spectator") }),
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
  topicId: z.string().min(1),
  topicTitle: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  participantIdentity: z.string().uuid(),
  displayName: z.string().min(1).max(40),
  role: debateRoleSchema,
  sideIndex: debateSideSchema.nullable(),
  isCreator: z.boolean(),
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

export const topicContracts = {
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
    errors: { 404: errorSchema, 409: sideUnavailableErrorSchema },
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
export type PrivateLobbyCreateInput = z.output<
  typeof privateLobbyCreateBodySchema
>;
export type PrivateLobbyPreview = z.output<typeof privateLobbyPreviewSchema>;
export type JoinByCodeInput = z.output<typeof joinCodeBodySchema>;
export type JoinResult = z.output<typeof joinResultSchema>;
export type SideUnavailableError = z.output<typeof sideUnavailableErrorSchema>;
