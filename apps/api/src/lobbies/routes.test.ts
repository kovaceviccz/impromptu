import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { createMemoryAccountStore } from "../accounts/store.js";
import { apiContract } from "../contracts.js";
import type { LiveKitGateway } from "../topics/livekit.js";
import {
  createMemoryPublicLobbyRepository,
  type PublicLobbyRecord,
} from "./data.js";
import { createMemoryPrivateLobbyStore } from "./store.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const livekit: LiveKitGateway = {
  async issueToken() {
    return "token";
  },
  async listParticipants() {
    return [];
  },
  async removeParticipant() {},
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function testApp(publicLobbies: PublicLobbyRecord[]) {
  const app = await buildApp({
    accounts: createMemoryAccountStore(),
    publicLobbies: createMemoryPublicLobbyRepository(publicLobbies),
    privateLobbies: createMemoryPrivateLobbyStore(),
    livekit,
    livekitPublicUrl: "ws://localhost:7880",
    tokenTtlSeconds: 60,
  });
  apps.push(app);
  return app;
}

function publicLobby(
  overrides: Partial<Omit<PublicLobbyRecord, "visibility">> = {},
): PublicLobbyRecord {
  return {
    id: "lobby-1",
    question: "Should school start later?",
    visibility: "public",
    participantIds: [],
    status: "waiting",
    ...overrides,
  };
}

describe("GET /api/lobbies/public", () => {
  it("returns sorted public lobby summaries with counts and statuses", async () => {
    const app = await testApp([
      publicLobby({
        id: "z",
        question: "Zebras or horses?",
        participantIds: ["participant-one", "participant-two"],
        status: "active",
      }),
      publicLobby({ id: "a", question: "Apples or oranges?" }),
    ]);

    const response = await app.inject({
      method: "GET",
      url: apiContract.publicLobbies.path,
    });
    const summaries = apiContract.publicLobbies.response.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(summaries.map(({ id }) => id)).toEqual(["a", "z"]);
    expect(summaries[1]).toEqual(
      expect.objectContaining({
        participantCount: 2,
        status: "active",
        visibility: "public",
      }),
    );
  });

  it("derives system lobby counts and status from LiveKit", async () => {
    const activeLivekit: LiveKitGateway = {
      ...livekit,
      async listParticipants(roomName) {
        if (roomName !== "debate-dream-cheating") return [];
        return [
          {
            displayName: "One",
            identity: "debater-one",
            role: "debater",
            sideIndex: 0,
          },
          {
            displayName: "Two",
            identity: "debater-two",
            role: "debater",
            sideIndex: 1,
          },
          {
            displayName: "Guest",
            identity: "spectator-one",
            role: "spectator",
            sideIndex: null,
          },
        ];
      },
    };
    const app = await buildApp({
      accounts: createMemoryAccountStore(),
      privateLobbies: createMemoryPrivateLobbyStore(),
      livekit: activeLivekit,
      livekitPublicUrl: "ws://localhost:7880",
      tokenTtlSeconds: 60,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: apiContract.publicLobbies.path,
    });
    const summaries = apiContract.publicLobbies.response.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(summaries).toHaveLength(3);
    expect(summaries).toContainEqual({
      id: "dream-cheating",
      question: "Can you cheat in a dream?",
      participantCount: 3,
      status: "active",
      visibility: "public",
    });
    expect(summaries.find(({ id }) => id === "moral-lying")?.status).toBe(
      "waiting",
    );
  });

  it("returns an empty list when there are no public lobbies", async () => {
    const app = await testApp([]);
    const response = await app.inject({
      method: "GET",
      url: apiContract.publicLobbies.path,
    });

    expect(response.statusCode).toBe(200);
    expect(apiContract.publicLobbies.response.parse(response.json())).toEqual(
      [],
    );
  });
});
