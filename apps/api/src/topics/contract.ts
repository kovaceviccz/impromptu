import { z } from "zod";

import { healthSchema } from "../health/contract.js";

export const debateSideSchema = z.union([z.literal(0), z.literal(1)]);

export const topicStatusSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  sideAvailability: z.tuple([z.boolean(), z.boolean()]),
  debaterCount: z.number().int().min(0).max(2),
  spectatorCount: z.number().int().min(0),
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

export const leaveBodySchema = z.strictObject({
  participantIdentity: z.string().uuid(),
});

export const joinResultSchema = z.strictObject({
  topicId: z.string().min(1),
  topicTitle: z.string().min(1),
  sides: z.tuple([z.string().min(1), z.string().min(1)]),
  participantIdentity: z.string().uuid(),
  displayName: z.string().min(1).max(40),
  role: z.enum(["debater", "spectator"]),
  sideIndex: z.union([z.literal(0), z.literal(1)]).nullable(),
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

export const topicContracts = {
  topics: {
    method: "GET",
    path: "/api/topics",
    response: topicsSchema,
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
export type JoinInput = z.output<typeof joinBodySchema>;
export type JoinResult = z.output<typeof joinResultSchema>;
export type SideUnavailableError = z.output<typeof sideUnavailableErrorSchema>;
