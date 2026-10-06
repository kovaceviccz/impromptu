import { topics } from "../topics/data.js";
import type { LiveKitGateway } from "../topics/livekit.js";
import type { PublicLobbySummary } from "./contract.js";

export type PublicLobbyRecord = {
  id: string;
  question: string;
  participantIds: string[];
  status: PublicLobbySummary["status"];
  visibility: "public";
};

export type PublicLobbyRepository = {
  list(): Promise<PublicLobbyRecord[]>;
};

export function createMemoryPublicLobbyRepository(
  initialLobbies: PublicLobbyRecord[] = [],
): PublicLobbyRepository {
  return {
    async list() {
      return initialLobbies;
    },
  };
}

export function createLivePublicLobbyRepository(
  livekit: LiveKitGateway,
): PublicLobbyRepository {
  return {
    async list() {
      return Promise.all(
        topics.map(async (topic) => {
          const participants = await livekit.listParticipants(
            `debate-${topic.id}`,
          );
          const debaterCount = participants.filter(
            ({ role }) => role === "debater",
          ).length;

          return {
            id: topic.id,
            question: topic.title,
            participantIds: participants.map(({ identity }) => identity),
            status: debaterCount >= 2 ? "active" : "waiting",
            visibility: "public",
          } satisfies PublicLobbyRecord;
        }),
      );
    },
  };
}

export function toPublicLobbySummary(
  lobby: PublicLobbyRecord,
): PublicLobbySummary {
  return {
    id: lobby.id,
    question: lobby.question,
    visibility: "public",
    participantCount: lobby.participantIds.length,
    status: lobby.status,
  };
}
