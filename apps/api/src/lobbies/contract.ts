import { z } from "zod";

export const lobbyStateSchema = z.enum([
  "WAITING",
  "DEBATE_IN_PROGRESS",
  "VOTING",
  "ENDED",
]);
export const lobbyStatusSchema = z.enum(["waiting", "active"]);
export const lobbySideSchema = z.union([z.literal(0), z.literal(1)]);

export const lobbyParticipantSchema = z.discriminatedUnion("role", [
  z.strictObject({
    id: z.string().min(1),
    role: z.literal("spectator"),
    sideIndex: z.null(),
  }),
  z.strictObject({
    id: z.string().min(1),
    role: z.literal("debater"),
    sideIndex: lobbySideSchema,
  }),
]);

export const positionChangeBodySchema = z.strictObject({
  sideIndex: lobbySideSchema.nullable(),
});

export const positionChangeParamsSchema = z.strictObject({
  lobbyId: z.string().min(1),
});

export const positionChangeRequestSchema = positionChangeBodySchema.extend({
  participantIdentity: z.string().uuid(),
});

export const positionChangeResultSchema = z.strictObject({
  participant: lobbyParticipantSchema,
});

export const positionChangeErrorSchema = z.strictObject({
  code: z.enum([
    "LOBBY_NOT_FOUND",
    "NOT_A_PARTICIPANT",
    "POSITION_UNAVAILABLE",
    "ROUND_ALREADY_STARTED",
  ]),
  message: z.string().min(1),
});

export const publicLobbySummarySchema = z.strictObject({
  id: z.string().min(1),
  question: z.string().trim().min(1),
  visibility: z.literal("public"),
  participantCount: z.number().int().nonnegative(),
  status: lobbyStatusSchema,
});

export const publicLobbyListSchema = z.array(publicLobbySummarySchema);

export const lobbyContracts = {
  publicLobbies: {
    method: "GET",
    path: "/api/lobbies/public",
    response: publicLobbyListSchema,
  },
  changePosition: {
    method: "PATCH",
    path: "/api/lobbies/:lobbyId/position",
    params: positionChangeParamsSchema,
    body: positionChangeRequestSchema,
    response: positionChangeResultSchema,
    errors: {
      403: positionChangeErrorSchema,
      404: positionChangeErrorSchema,
      409: positionChangeErrorSchema,
    },
  },
} as const;

export type PublicLobbySummary = z.output<typeof publicLobbySummarySchema>;
export type LobbyState = z.output<typeof lobbyStateSchema>;
export type LobbyParticipant = z.output<typeof lobbyParticipantSchema>;
export type PositionChangeInput = z.output<typeof positionChangeBodySchema>;
export type PositionChangeRequest = z.output<
  typeof positionChangeRequestSchema
>;
export type PositionChangeResult = z.output<typeof positionChangeResultSchema>;
export type PositionChangeError = z.output<typeof positionChangeErrorSchema>;
