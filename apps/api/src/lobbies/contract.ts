import { z } from "zod";

export const lobbyStateSchema = z.enum([
  "WAITING",
  "DEBATE_IN_PROGRESS",
  "VOTING",
  "ENDED",
]);

export type LobbyState = z.output<typeof lobbyStateSchema>;
