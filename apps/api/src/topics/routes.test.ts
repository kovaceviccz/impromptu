import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import { apiContract } from "../contracts.js";
import { createMemoryAccountStore } from "../accounts/store.js";
import { SESSION_COOKIE } from "../accounts/routes.js";
import { hashLobbyCode } from "../lobbies/codes.js";
import {
  createMemoryPrivateLobbyStore,
  type PrivateLobbyStore,
} from "../lobbies/store.js";
import {
  createLiveKitGateway,
  type DebateRole,
  type LiveKitGateway,
  type RoomParticipant,
} from "./livekit.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const debaterInput = {
  displayName: "Test debater",
  intent: "debater",
  sideIndex: 0,
} as const;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fakeLiveKit(
  tokenFor: (role: DebateRole, identity: string) => string = (_, identity) =>
    identity,
) {
  const active = new Map<string, RoomParticipant[]>();
  const issued: DebateRole[] = [];
  const issuedRooms: string[] = [];
  const issuedNames: string[] = [];
  const removed: { roomName: string; identity: string }[] = [];

  const gateway: LiveKitGateway = {
    async listParticipants(roomName) {
      return active.get(roomName) ?? [];
    },
    async removeParticipant(roomName, identity) {
      removed.push({ roomName, identity });
      active.set(
        roomName,
        (active.get(roomName) ?? []).filter(
          (participant) => participant.identity !== identity,
        ),
      );
    },
    async issueToken({ displayName, identity, role, roomName }) {
      issued.push(role);
      issuedRooms.push(roomName);
      issuedNames.push(displayName);
      return tokenFor(role, identity);
    },
    async verifyParticipantToken(token) {
      return token;
    },
  };

  return { active, gateway, issued, issuedNames, issuedRooms, removed };
}

async function testApp(
  livekit: LiveKitGateway,
  privateLobbies: PrivateLobbyStore = createMemoryPrivateLobbyStore(),
) {
  const app = await buildApp({
    accounts: createMemoryAccountStore(),
    livekit,
    privateLobbies,
    livekitPublicUrl: "ws://localhost:7880",
    tokenTtlSeconds: 60,
  });
  apps.push(app);
  return app;
}

describe("API contracts", () => {
  it("returns the predefined topics with runtime-valid status data", async () => {
    const { active, gateway } = fakeLiveKit();
    active.set("debate-dream-cheating", [
      {
        displayName: "Ada",
        identity: "debater",
        role: "debater",
        sideIndex: 0,
      },
      {
        displayName: "Spectator",
        identity: "spectator-one",
        role: "spectator",
        sideIndex: null,
      },
      {
        displayName: "Grace",
        identity: "spectator-two",
        role: "spectator",
        sideIndex: null,
      },
    ]);
    const app = await testApp(gateway);

    const response = await app.inject({ method: "GET", url: "/api/topics" });
    const topics = apiContract.topics.response.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(topics.map((topic) => topic.title)).toEqual([
      "Can you cheat in a dream?",
      "Is lying ever moral?",
      "Is privacy a human right?",
    ]);
    expect(topics[0]).toEqual({
      id: "dream-cheating",
      title: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      sideAvailability: [false, true],
      debaterCount: 1,
      spectatorCount: 2,
      participants: [
        { displayName: "Ada", role: "debater", sideIndex: 0 },
        { displayName: "Spectator", role: "spectator", sideIndex: null },
        { displayName: "Grace", role: "spectator", sideIndex: null },
      ],
    });
  });

  it("reserves both requested sides and rejects a third debater", async () => {
    const { gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);

    const joins = await Promise.all(
      [0, 1, 1].map((sideIndex) =>
        app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/join",
          payload: { ...debaterInput, sideIndex },
        }),
      ),
    );

    expect(joins.map((response) => response.statusCode)).toEqual([
      200, 200, 409,
    ]);
    expect(
      joins
        .slice(0, 2)
        .map((response) => apiContract.join.response.parse(response.json())),
    ).toEqual([
      expect.objectContaining({ role: "debater", sideIndex: 0 }),
      expect.objectContaining({ role: "debater", sideIndex: 1 }),
    ]);
    expect(apiContract.join.errors[409].parse(joins[2]?.json())).toEqual({
      code: "SIDE_UNAVAILABLE",
      message:
        "Both debater positions are taken. You can still join as a spectator.",
      sideIndex: 1,
      topicTitle: "Can you cheat in a dream?",
    });
    expect(issued).toEqual(["debater", "debater"]);
  });

  it("does not move a debater to an open side they did not choose", async () => {
    const { gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);

    const [first, competing] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/topics/dream-cheating/join",
        payload: debaterInput,
      }),
      app.inject({
        method: "POST",
        url: "/api/topics/dream-cheating/join",
        payload: { ...debaterInput, displayName: "Second debater" },
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(competing.statusCode).toBe(409);
    expect(apiContract.join.errors[409].parse(competing.json())).toEqual(
      expect.objectContaining({
        code: "SIDE_UNAVAILABLE",
        message:
          "That side was just taken. Choose another side or spectate instead.",
        sideIndex: 0,
      }),
    );
    expect(issued).toEqual(["debater"]);

    const topicsResponse = await app.inject({
      method: "GET",
      url: "/api/topics",
    });
    const statuses = apiContract.topics.response.parse(topicsResponse.json());
    expect(statuses[0]?.sideAvailability).toEqual([false, true]);
  });

  it("honors explicit spectator intent even when debater slots are open", async () => {
    const { gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { intent: "spectator" },
    });

    expect(response.statusCode).toBe(200);
    expect(apiContract.join.response.parse(response.json())).toEqual(
      expect.objectContaining({
        displayName: "Spectator",
        role: "spectator",
        sideIndex: null,
      }),
    );
    expect(issued).toEqual(["spectator"]);
  });

  it("isolates private lobby participants and tracks its creator", async () => {
    const { active, gateway, issuedNames, issuedRooms } = fakeLiveKit();
    active.set("debate-dream-cheating", [
      {
        displayName: "Public debater",
        identity: "public-debater",
        role: "debater",
        sideIndex: 0,
      },
    ]);
    const app = await testApp(gateway);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/private",
      payload: {
        displayName: "Lobby creator",
        intent: "debater",
        sideIndex: 0,
      },
    });
    const creator = apiContract.privateTopic.response.parse(
      createResponse.json(),
    );

    expect(createResponse.statusCode).toBe(200);
    expect(creator).toEqual(
      expect.objectContaining({
        topicId: "dream-cheating",
        role: "debater",
        sideIndex: 0,
        isCreator: true,
        hostIdentity: expect.any(String),
        joinCode: expect.any(String),
      }),
    );
    expect(creator.lobbyId).not.toBe("dream-cheating");

    const lookupResponse = await app.inject({
      method: "POST",
      url: apiContract.privateLobbyLookup.path,
      payload: { code: creator.joinCode },
    });
    const preview = apiContract.privateLobbyLookup.response.parse(
      lookupResponse.json(),
    );
    expect(preview.sideAvailability).toEqual([false, true]);
    expect(preview.debaterCount).toBe(1);

    const privateJoinResponse = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: {
        code: creator.joinCode,
        displayName: "Private guest",
        intent: "debater",
        sideIndex: 1,
      },
    });
    const privateJoin = apiContract.joinByCode.response.parse(
      privateJoinResponse.json(),
    );
    expect(privateJoinResponse.statusCode).toBe(200);
    expect(privateJoin).toEqual(
      expect.objectContaining({
        lobbyId: creator.lobbyId,
        displayName: "Private guest",
        role: "debater",
        sideIndex: 1,
        isCreator: false,
        hostIdentity: creator.participantIdentity,
      }),
    );
    expect(issuedNames).toContain("Private guest");

    const privateRoomName = `debate-${creator.lobbyId}`;
    active.set(privateRoomName, [
      {
        displayName: "Private guest",
        identity: privateJoin.participantIdentity,
        role: "debater",
        sideIndex: 1,
      },
    ]);
    const leaveResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/leave",
      payload: {
        lobbyId: privateJoin.lobbyId,
        token: privateJoin.token,
      },
    });
    expect(leaveResponse.statusCode).toBe(200);
    expect(await gateway.listParticipants(privateRoomName)).toEqual([]);

    const repeatedLeaveResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/leave",
      payload: {
        lobbyId: privateJoin.lobbyId,
        token: privateJoin.token,
      },
    });
    expect(repeatedLeaveResponse.statusCode).toBe(200);
    expect(await gateway.listParticipants(privateRoomName)).toEqual([]);

    const privateSpectatorResponse = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: {
        code: creator.joinCode,
        displayName: "Private spectator",
        intent: "spectator",
      },
    });
    expect(privateSpectatorResponse.statusCode).toBe(200);
    expect(
      apiContract.joinByCode.response.parse(privateSpectatorResponse.json()),
    ).toEqual(
      expect.objectContaining({
        lobbyId: creator.lobbyId,
        displayName: "Private spectator",
        role: "spectator",
        sideIndex: null,
        isCreator: false,
        hostIdentity: creator.participantIdentity,
      }),
    );

    const publicJoinResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { ...debaterInput, sideIndex: 1 },
    });
    expect(publicJoinResponse.statusCode).toBe(200);
    expect(apiContract.join.response.parse(publicJoinResponse.json())).toEqual(
      expect.objectContaining({
        lobbyId: "dream-cheating",
        sideIndex: 1,
        isCreator: false,
        hostIdentity: null,
      }),
    );
    expect(issuedRooms).toEqual([
      `debate-${creator.lobbyId}`,
      `debate-${creator.lobbyId}`,
      `debate-${creator.lobbyId}`,
      "debate-dream-cheating",
    ]);
  });

  it("changes roles inside a private lobby without leaving it", async () => {
    const { active, gateway, issuedRooms } = fakeLiveKit();
    const app = await testApp(gateway);
    const creator = apiContract.privateTopic.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/private",
          payload: { displayName: "Creator", intent: "spectator" },
        })
      ).json(),
    );
    const privateRoomName = `debate-${creator.lobbyId}`;
    active.set(privateRoomName, [
      {
        displayName: "Creator",
        identity: creator.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
    ]);

    const lookup = apiContract.privateLobbyLookup.response.parse(
      (
        await app.inject({
          method: "POST",
          url: apiContract.privateLobbyLookup.path,
          payload: { code: creator.joinCode },
        })
      ).json(),
    );
    expect(lookup.participants).toEqual([
      { displayName: "Creator", role: "spectator", sideIndex: null },
    ]);

    const switchResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { ...debaterInput, lobbyId: creator.lobbyId, sideIndex: 1 },
    });

    expect(switchResponse.statusCode).toBe(200);
    expect(apiContract.join.response.parse(switchResponse.json())).toEqual(
      expect.objectContaining({
        lobbyId: creator.lobbyId,
        hostIdentity: creator.participantIdentity,
        role: "debater",
        sideIndex: 1,
      }),
    );
    expect(issuedRooms.at(-1)).toBe(privateRoomName);
  });

  it("preserves the host identity through verified role changes and subsequent guest joins", async () => {
    const { active, gateway } = fakeLiveKit();
    const signed = createLiveKitGateway({
      apiKey: "test-key",
      apiSecret: "a-test-secret-that-is-at-least-32-characters",
      apiUrl: "http://localhost:7880",
      tokenTtlSeconds: 60,
    });
    gateway.issueToken = (input) => signed.issueToken(input);
    gateway.verifyParticipantToken = (token, roomName) =>
      signed.verifyParticipantToken(token, roomName);
    const app = await testApp(gateway);
    const creator = apiContract.privateTopic.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/private",
          payload: { displayName: "Creator", intent: "debater", sideIndex: 0 },
        })
      ).json(),
    );
    const roomName = `debate-${creator.lobbyId}`;
    active.set(roomName, [
      {
        displayName: "Creator",
        identity: creator.participantIdentity,
        role: "debater",
        sideIndex: 0,
      },
    ]);
    const switchRole = async (previousToken: string, input: object) =>
      app.inject({
        method: "POST",
        url: "/api/topics/dream-cheating/join",
        payload: { ...input, lobbyId: creator.lobbyId, previousToken },
      });
    const spectator = apiContract.join.response.parse(
      (await switchRole(creator.token, { intent: "spectator" })).json(),
    );
    expect(spectator).toMatchObject({
      participantIdentity: creator.participantIdentity,
      hostIdentity: creator.participantIdentity,
      isCreator: true,
    });
    active.set(roomName, [
      {
        displayName: "Spectator",
        identity: creator.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
    ]);
    const debater = apiContract.join.response.parse(
      (await switchRole(spectator.token, debaterInput)).json(),
    );
    expect(debater).toMatchObject({
      participantIdentity: creator.participantIdentity,
      hostIdentity: creator.participantIdentity,
      isCreator: true,
      sideIndex: 0,
    });
    const guest = apiContract.joinByCode.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/join-code",
          payload: {
            code: creator.joinCode,
            displayName: "Guest",
            intent: "spectator",
          },
        })
      ).json(),
    );
    expect(guest.hostIdentity).toBe(debater.participantIdentity);
    expect(guest.isCreator).toBe(false);
    // A token for another room cannot claim the creator's identity here.
    const foreignToken = await signed.issueToken({
      displayName: "Other",
      identity: creator.participantIdentity,
      role: "spectator",
      roomName: "debate-other",
      sideIndex: null,
    });
    expect(
      (await switchRole(foreignToken, { intent: "spectator" })).statusCode,
    ).toBe(401);
    expect(
      (await switchRole("forged-token", { intent: "spectator" })).statusCode,
    ).toBe(401);
    active.set(roomName, [
      {
        displayName: "Guest",
        identity: guest.participantIdentity,
        role: "debater",
        sideIndex: 1,
      },
    ]);
    expect(
      (await switchRole(debater.token, { ...debaterInput, sideIndex: 1 }))
        .statusCode,
    ).toBe(409);
  });

  it("returns readable membership and host identity, handles retrieval failure, and removes a guest idempotently", async () => {
    const { active, gateway, removed } = fakeLiveKit();
    const signed = createLiveKitGateway({
      apiKey: "test-key",
      apiSecret: "a-test-secret-that-is-at-least-32-characters",
      apiUrl: "http://localhost:7880",
      tokenTtlSeconds: 60,
    });
    gateway.issueToken = (input) => signed.issueToken(input);
    gateway.verifyParticipantToken = (token, roomName) =>
      signed.verifyParticipantToken(token, roomName);
    const app = await testApp(gateway);
    const creator = apiContract.privateTopic.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/private",
          payload: { displayName: "Host user", intent: "spectator" },
        })
      ).json(),
    );
    const guest = apiContract.joinByCode.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/join-code",
          payload: {
            code: creator.joinCode,
            displayName: "Guest Ada",
            intent: "spectator",
          },
        })
      ).json(),
    );
    const room = `debate-${creator.lobbyId}`;
    const hostParticipant = {
      identity: creator.participantIdentity,
      displayName: "Host user",
      role: "spectator" as const,
      sideIndex: null,
    };
    const guestParticipant = {
      identity: guest.participantIdentity,
      displayName: "Guest Ada",
      role: "spectator" as const,
      sideIndex: null,
    };
    active.set(room, [hostParticipant, guestParticipant, guestParticipant]);
    const retrieve = () =>
      app.inject({
        method: "POST",
        url: "/api/topics/dream-cheating/participants",
        payload: { lobbyId: creator.lobbyId, token: creator.token },
      });
    const snapshot = apiContract.roomParticipants.response.parse(
      (await retrieve()).json(),
    );
    expect(snapshot).toEqual({
      hostIdentity: creator.participantIdentity,
      participants: [hostParticipant, guestParticipant],
    });
    expect(snapshot).not.toHaveProperty("joinCode");
    const original = gateway.listParticipants.bind(gateway);
    gateway.listParticipants = async () => {
      throw new Error("LiveKit unavailable");
    };
    const failed = await retrieve();
    expect(failed.statusCode).toBe(503);
    expect(failed.json().message).toContain("Participants could not be loaded");
    gateway.listParticipants = original;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/topics/dream-cheating/leave",
            payload: {
              lobbyId: creator.lobbyId,
              token: guest.token,
            },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      apiContract.roomParticipants.response.parse((await retrieve()).json())
        .participants,
    ).toEqual([hostParticipant]);
    expect(removed).toHaveLength(2);
    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/participants",
      payload: { lobbyId: creator.lobbyId, token: "invalid" },
    });
    expect(unauthorized.statusCode).toBe(401);
  });

  it("allows an authenticated user and a named guest to join by code without exposing the creator's code in public data", async () => {
    const { gateway, issuedNames } = fakeLiveKit();
    const app = await testApp(gateway);
    const creator = apiContract.privateTopic.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/private",
          payload: { displayName: "Creator", intent: "spectator" },
        })
      ).json(),
    );
    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "private_member",
        email: "private@example.com",
        password: "strong-password",
      },
    });
    expect(registration.statusCode).toBe(201);
    const cookie = registration.cookies.find(
      ({ name }) => name === SESSION_COOKIE,
    );
    expect(cookie).toBeDefined();
    const signedIn = await app.inject({
      method: "POST",
      url: "/api/topics/join-code",
      cookies: { [cookie!.name]: cookie!.value },
      payload: {
        code: creator.joinCode,
        displayName: "Registered member",
        intent: "spectator",
      },
    });
    expect(signedIn.statusCode).toBe(200);
    const guest = await app.inject({
      method: "POST",
      url: "/api/topics/join-code",
      payload: {
        code: creator.joinCode,
        displayName: "Guest Ada",
        intent: "spectator",
      },
    });
    expect(guest.statusCode).toBe(200);
    expect(issuedNames).toEqual(["Creator", "Registered member", "Guest Ada"]);
    expect(guest.json()).not.toHaveProperty("joinCode");
    for (const url of ["/api/topics"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(creator.joinCode);
      expect(response.body).not.toContain("joinCode");
    }
  });

  it("rejects a role change into a lobby of another topic", async () => {
    const { gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);
    const otherTopicLobby = apiContract.privateTopic.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/moral-lying/private",
          payload: { displayName: "Creator", intent: "spectator" },
        })
      ).json(),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { intent: "spectator", lobbyId: otherTopicLobby.lobbyId },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Lobby not found" });
    expect(issued).toEqual(["spectator"]);
  });

  it("does not join a private lobby when the requested side is unavailable", async () => {
    const { gateway, issuedNames } = fakeLiveKit();
    const app = await testApp(gateway);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/private",
      payload: {
        displayName: "Lobby creator",
        intent: "debater",
        sideIndex: 0,
      },
    });
    const creator = apiContract.privateTopic.response.parse(
      createResponse.json(),
    );

    const joinResponse = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: {
        code: creator.joinCode,
        displayName: "Waiting guest",
        intent: "debater",
        sideIndex: 0,
      },
    });

    expect(joinResponse.statusCode).toBe(409);
    expect(
      apiContract.joinByCode.errors[409].parse(joinResponse.json()),
    ).toEqual(
      expect.objectContaining({
        code: "SIDE_UNAVAILABLE",
        message:
          "That side was just taken. Choose another side or spectate instead.",
        sideIndex: 0,
      }),
    );
    expect(issuedNames).toEqual(["Lobby creator"]);
  });

  it("rejects private codes for missing and expired lobbies", async () => {
    const { gateway } = fakeLiveKit();
    const privateLobbies = createMemoryPrivateLobbyStore([
      {
        id: "expired-lobby",
        topicId: "dream-cheating",
        codeHash: hashLobbyCode("EXPIRED1"),
        creatorIdentity: "creator-identity",
        createdAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    ]);
    const app = await testApp(gateway, privateLobbies);

    for (const code of ["MISSING1", "EXPIRED1"]) {
      const lookup = await app.inject({
        method: "POST",
        url: apiContract.privateLobbyLookup.path,
        payload: { code },
      });
      expect(lookup.statusCode).toBe(404);
      expect(
        apiContract.privateLobbyLookup.errors[404].parse(lookup.json()),
      ).toEqual({
        message: "Private lobby not found",
      });

      const join = await app.inject({
        method: "POST",
        url: apiContract.joinByCode.path,
        payload: { code, displayName: "Guest", intent: "spectator" },
      });
      expect(join.statusCode).toBe(404);
      expect(apiContract.joinByCode.errors[404].parse(join.json())).toEqual({
        message: "Private lobby not found",
      });
    }
  });

  it("releases a pending debater reservation when its participant leaves", async () => {
    const { gateway } = fakeLiveKit();
    const privateLobbies = createMemoryPrivateLobbyStore();
    const findPrivateLobbyById = vi.spyOn(privateLobbies, "findById");
    const app = await testApp(gateway, privateLobbies);

    const joinResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: debaterInput,
    });
    const join = apiContract.join.response.parse(joinResponse.json());

    const occupiedResponse = await app.inject({
      method: "GET",
      url: "/api/topics",
    });
    const occupiedTopics = apiContract.topics.response.parse(
      occupiedResponse.json(),
    );
    expect(occupiedTopics[0]?.debaterCount).toBe(1);
    expect(occupiedTopics[0]?.participants).toEqual([
      { displayName: "Test debater", role: "debater", sideIndex: 0 },
    ]);

    const leaveResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/leave",
      payload: {
        lobbyId: join.lobbyId,
        token: join.token,
      },
    });

    expect(leaveResponse.statusCode).toBe(200);
    expect(findPrivateLobbyById).not.toHaveBeenCalled();
    expect(apiContract.leave.response.parse(leaveResponse.json())).toEqual({
      status: "ok",
    });

    const availableResponse = await app.inject({
      method: "GET",
      url: "/api/topics",
    });
    const availableTopics = apiContract.topics.response.parse(
      availableResponse.json(),
    );
    expect(availableTopics[0]?.debaterCount).toBe(0);
    expect(availableTopics[0]?.participants).toEqual([]);
  });

  it("moves a spectator into an open side without holding a side while spectating", async () => {
    const { active, gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);

    const spectatorResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { intent: "spectator" },
    });
    const spectator = apiContract.join.response.parse(spectatorResponse.json());
    active.set("debate-dream-cheating", [
      {
        displayName: spectator.displayName,
        identity: spectator.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
    ]);

    const spectatingStatus = apiContract.topics.response.parse(
      (await app.inject({ method: "GET", url: "/api/topics" })).json(),
    )[0];
    expect(spectatingStatus).toEqual(
      expect.objectContaining({
        debaterCount: 0,
        sideAvailability: [true, true],
        spectatorCount: 1,
      }),
    );

    const debaterResponse = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { ...debaterInput, displayName: "Former spectator" },
    });
    const debater = apiContract.join.response.parse(debaterResponse.json());
    expect(debater).toEqual(
      expect.objectContaining({
        displayName: "Former spectator",
        role: "debater",
        sideIndex: 0,
      }),
    );
    expect(debater.participantIdentity).not.toBe(spectator.participantIdentity);
    active.set("debate-dream-cheating", [
      {
        displayName: "Former spectator",
        identity: debater.participantIdentity,
        role: "debater",
        sideIndex: 0,
      },
    ]);

    const debatingStatus = apiContract.topics.response.parse(
      (await app.inject({ method: "GET", url: "/api/topics" })).json(),
    )[0];
    expect(debatingStatus).toEqual(
      expect.objectContaining({
        debaterCount: 1,
        participants: [
          { displayName: "Former spectator", role: "debater", sideIndex: 0 },
        ],
        sideAvailability: [false, true],
        spectatorCount: 0,
      }),
    );
    expect(issued).toEqual(["spectator", "debater"]);
  });

  it("rejects a debater request when both positions are occupied", async () => {
    const { active, gateway, issued } = fakeLiveKit();
    active.set("debate-dream-cheating", [
      { displayName: "Ada", identity: "a", role: "debater", sideIndex: 0 },
      { displayName: "Alan", identity: "b", role: "debater", sideIndex: 1 },
    ]);
    const app = await testApp(gateway);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: debaterInput,
    });

    expect(response.statusCode).toBe(409);
    expect(apiContract.join.errors[409].parse(response.json())).toEqual({
      code: "SIDE_UNAVAILABLE",
      message:
        "Both debater positions are taken. You can still join as a spectator.",
      sideIndex: 0,
      topicTitle: "Can you cheat in a dream?",
    });
    expect(issued).toEqual([]);
  });

  it("rejects an unknown topic", async () => {
    const { gateway } = fakeLiveKit();
    const app = await testApp(gateway);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/not-a-topic/join",
      payload: debaterInput,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Topic not found" });
  });

  it("rejects an invalid join request at runtime", async () => {
    const { gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { displayName: "", intent: "debater", sideIndex: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(issued).toEqual([]);
  });

  it("rejects an invalid debate side at runtime", async () => {
    const { gateway, issued } = fakeLiveKit();
    const app = await testApp(gateway);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { ...debaterInput, sideIndex: 2 },
    });

    expect(response.statusCode).toBe(400);
    expect(issued).toEqual([]);
  });

  it("fails response serialization when a handler violates the contract", async () => {
    const { gateway } = fakeLiveKit(() => "");
    const app = await testApp(gateway);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: debaterInput,
    });

    expect(response.statusCode).toBe(500);
  });
});

describe("LiveKit grants", () => {
  it("mints a spectator token that cannot publish", async () => {
    const apiKey = "test-key";
    const apiSecret = "a-test-secret-that-is-at-least-32-characters";
    const gateway = createLiveKitGateway({
      apiKey,
      apiSecret,
      apiUrl: "http://localhost:7880",
      tokenTtlSeconds: 60,
    });

    const token = await gateway.issueToken({
      displayName: "Test spectator",
      identity: "spectator-id",
      role: "spectator",
      roomName: "debate-dream-cheating",
      sideIndex: null,
    });
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);

    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canPublishData).toBe(true);
    expect(claims.video?.canUpdateOwnMetadata).toBe(true);
    expect(claims.name).toBe("Test spectator");
  });

  it("prevents debaters from writing vote metadata", async () => {
    const apiKey = "test-key";
    const apiSecret = "a-test-secret-that-is-at-least-32-characters";
    const gateway = createLiveKitGateway({
      apiKey,
      apiSecret,
      apiUrl: "http://localhost:7880",
      tokenTtlSeconds: 60,
    });

    const token = await gateway.issueToken({
      displayName: "Test debater",
      identity: "debater-id",
      role: "debater",
      roomName: "debate-dream-cheating",
      sideIndex: 0,
    });
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);

    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canPublishData).toBe(false);
    expect(claims.video?.canUpdateOwnMetadata).toBe(false);
    expect(claims.attributes?.["debate.side"]).toBe("0");
  });
});
