import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import { apiContract } from "../contracts.js";
import { createMemoryAccountStore } from "../accounts/store.js";
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
  const roomMetadata = new Map<string, string>();

  const gateway: LiveKitGateway = {
    async verifyParticipantToken(token) {
      return token;
    },
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
    async updateRoomMetadata(roomName, metadata) {
      roomMetadata.set(roomName, metadata);
    },
    async issueToken({ displayName, identity, role, roomName }) {
      issued.push(role);
      issuedRooms.push(roomName);
      issuedNames.push(displayName);
      return tokenFor(role, identity);
    },
  };

  return {
    active,
    gateway,
    issued,
    issuedNames,
    issuedRooms,
    removed,
    roomMetadata,
  };
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
  it("creates one lobby per new topic and keeps private topics out of public discovery", async () => {
    const { gateway } = fakeLiveKit();
    const store = createMemoryPrivateLobbyStore();
    const app = await testApp(gateway, store);
    const create = apiContract.createLobby;
    const sides: [string, string] = ["Yes: it can", "No: it cannot"];

    const invalid = await app.inject({
      method: create.method,
      url: create.path,
      payload: {
        name: "   ",
        sides,
        visibility: "public",
        displayName: "Host",
        intent: "spectator",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(await store.listPublic()).toEqual([]);

    const publicResponse = await app.inject({
      method: create.method,
      url: create.path,
      payload: {
        name: "Can machines dream?",
        sides,
        visibility: "public",
        displayName: "Host",
        intent: "spectator",
      },
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicJoin = create.response.parse(publicResponse.json());
    expect(publicJoin).toMatchObject({
      lobbyId: publicJoin.topicId,
      topicTitle: "Can machines dream?",
      sides,
      visibility: "public",
      isCreator: true,
    });
    expect(publicJoin.joinCode).toBeUndefined();
    expect(await store.findById(publicJoin.topicId)).toMatchObject({
      topicId: publicJoin.topicId,
      name: "Can machines dream?",
      side0: sides[0],
      side1: sides[1],
      visibility: "public",
      expiresAt: null,
    });

    const duplicate = await app.inject({
      method: create.method,
      url: create.path,
      payload: {
        name: "can machines DREAM?",
        sides,
        visibility: "public",
        displayName: "Host",
        intent: "spectator",
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const privateResponse = await app.inject({
      method: create.method,
      url: create.path,
      payload: {
        name: "Should robots vote?",
        sides,
        visibility: "private",
        displayName: "Private host",
        intent: "spectator",
      },
    });
    expect(privateResponse.statusCode).toBe(200);
    const privateJoin = create.response.parse(privateResponse.json());
    expect(privateJoin.lobbyId).toBe(privateJoin.topicId);
    expect(privateJoin.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await store.findById(privateJoin.topicId))?.expiresAt).toBeNull();
    const directPrivateJoin = await app.inject({
      method: "POST",
      url: `/api/topics/${privateJoin.topicId}/join`,
      payload: { intent: "spectator" },
    });
    expect(directPrivateJoin.statusCode).toBe(403);

    const visible = apiContract.topics.response.parse(
      (
        await app.inject({ method: "GET", url: apiContract.topics.path })
      ).json(),
    );
    expect(visible).toHaveLength(4);
    expect(visible).toContainEqual(
      expect.objectContaining({
        id: publicJoin.topicId,
        title: "Can machines dream?",
        sides,
      }),
    );
    expect(JSON.stringify(visible)).not.toContain(privateJoin.topicId);
    expect(JSON.stringify(visible)).not.toContain(privateJoin.joinCode);
  });

  it("joins a created public topic and removes its card when the creator closes it", async () => {
    const { active, gateway } = fakeLiveKit();
    const app = await testApp(gateway);
    const created = apiContract.createLobby.response.parse(
      (
        await app.inject({
          method: "POST",
          url: apiContract.createLobby.path,
          payload: {
            name: "Can machines dream?",
            sides: ["Yes: it can", "No: it cannot"],
            visibility: "public",
            displayName: "Host",
            intent: "spectator",
          },
        })
      ).json(),
    );
    const join = await app.inject({
      method: "POST",
      url: `/api/topics/${created.topicId}/join`,
      payload: { intent: "spectator" },
    });
    expect(join.statusCode).toBe(200);
    const guest = apiContract.join.response.parse(join.json());
    expect(guest.lobbyId).toBe(created.topicId);
    const repeated = await app.inject({
      method: "POST",
      url: `/api/topics/${created.topicId}/join`,
      payload: { intent: "spectator", previousToken: guest.token },
    });
    expect(repeated.statusCode).toBe(200);
    expect(
      apiContract.join.response.parse(repeated.json()).participantIdentity,
    ).toBe(guest.participantIdentity);

    active.set(`debate-${created.topicId}`, [
      {
        displayName: "Host",
        identity: created.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
    ]);
    const closed = await app.inject({
      method: "POST",
      url: `/api/topics/${created.topicId}/close`,
      payload: { lobbyId: created.topicId, token: created.token },
    });
    expect(closed.statusCode).toBe(200);
    const visible = apiContract.topics.response.parse(
      (
        await app.inject({ method: "GET", url: apiContract.topics.path })
      ).json(),
    );
    expect(visible).toHaveLength(3);
    expect(visible.some((topic) => topic.id === created.topicId)).toBe(false);
    const stale = await app.inject({
      method: "POST",
      url: `/api/topics/${created.topicId}/join`,
      payload: { intent: "spectator" },
    });
    expect(stale.statusCode).toBe(404);
  });

  it("shows the starter topic room directly with its current participants", async () => {
    const { active, gateway } = fakeLiveKit();
    const app = await testApp(gateway);
    active.set("debate-dream-cheating", [
      {
        identity: "first",
        displayName: "First",
        role: "debater",
        sideIndex: 0,
      },
      {
        identity: "second",
        displayName: "Second",
        role: "debater",
        sideIndex: 1,
      },
      {
        identity: "viewer",
        displayName: "Viewer",
        role: "spectator",
        sideIndex: null,
      },
    ]);
    const visible = apiContract.topics.response.parse(
      (
        await app.inject({ method: "GET", url: apiContract.topics.path })
      ).json(),
    );
    expect(visible).toHaveLength(3);
    expect(visible[0]).toMatchObject({
      id: "dream-cheating",
      debaterCount: 2,
      spectatorCount: 1,
      sideAvailability: [false, false],
    });
  });

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

  it("assigns the first public-lobby participant as host, promotes a present participant on leave, and lets the host start", async () => {
    const { active, gateway } = fakeLiveKit();
    gateway.verifyParticipantToken = async (token) => token;
    const app = await testApp(gateway);
    const first = apiContract.join.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/join",
          payload: { intent: "spectator" },
        })
      ).json(),
    );
    const second = apiContract.join.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/join",
          payload: { ...debaterInput, sideIndex: 0 },
        })
      ).json(),
    );

    expect(first).toEqual(
      expect.objectContaining({
        isCreator: true,
        hostIdentity: first.participantIdentity,
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({
        isCreator: false,
        hostIdentity: first.participantIdentity,
      }),
    );

    const third = apiContract.join.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/join",
          payload: { ...debaterInput, sideIndex: 1 },
        })
      ).json(),
    );
    const fourth = apiContract.join.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/join",
          payload: { intent: "spectator" },
        })
      ).json(),
    );
    active.set("debate-dream-cheating", [
      {
        displayName: first.displayName,
        identity: first.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
      {
        displayName: second.displayName,
        identity: second.participantIdentity,
        role: "debater",
        sideIndex: 0,
      },
      {
        displayName: third.displayName,
        identity: third.participantIdentity,
        role: "debater",
        sideIndex: 1,
      },
      {
        displayName: fourth.displayName,
        identity: fourth.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
    ]);

    const leaveHost = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/leave",
      payload: {
        lobbyId: "dream-cheating",
        token: first.token,
      },
    });
    expect(leaveHost.statusCode).toBe(200);

    const status = apiContract.roomParticipants.response.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/participants",
          payload: {
            lobbyId: "dream-cheating",
            token: second.participantIdentity,
          },
        })
      ).json(),
    );
    expect(status.hostIdentity).toBe(second.participantIdentity);
    expect(status.state).toBe("WAITING");

    const started = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/start",
      payload: {
        lobbyId: "dream-cheating",
        token: second.participantIdentity,
      },
    });
    expect(started.statusCode).toBe(200);
    expect(apiContract.startDebate.response.parse(started.json())).toEqual({
      state: "DEBATE_IN_PROGRESS",
    });
  });

  it("keeps a created private topic accessible by code and enforces room identity", async () => {
    const { active, gateway, removed } = fakeLiveKit();
    const signed = createLiveKitGateway({
      apiKey: "test-key",
      apiSecret: "a-test-secret-that-is-at-least-32-characters",
      apiUrl: "http://localhost:7880",
      tokenTtlSeconds: 86_400,
    });
    gateway.issueToken = (input) => signed.issueToken(input);
    gateway.verifyParticipantToken = (token, roomName) =>
      signed.verifyParticipantToken(token, roomName);
    const app = await testApp(gateway);
    const response = await app.inject({
      method: "POST",
      url: apiContract.createLobby.path,
      payload: {
        name: "Can trees communicate?",
        sides: ["Yes, they can", "No, they cannot"],
        visibility: "private",
        displayName: "Creator",
        intent: "spectator",
      },
    });
    expect(response.statusCode).toBe(200);
    const creator = apiContract.createLobby.response.parse(response.json());
    expect(creator.topicId).toBe(creator.lobbyId);
    expect(creator.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(
      (await app.inject({ method: "GET", url: "/api/topics" })).body,
    ).not.toContain(creator.topicId);
    const lookup = apiContract.privateLobbyLookup.response.parse(
      (
        await app.inject({
          method: "POST",
          url: apiContract.privateLobbyLookup.path,
          payload: { code: creator.joinCode },
        })
      ).json(),
    );
    expect(lookup).toMatchObject({
      id: creator.topicId,
      lobbyId: creator.topicId,
      title: "Can trees communicate?",
      sides: ["Yes, they can", "No, they cannot"],
    });
    const occupied = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: {
        code: creator.joinCode,
        displayName: "First",
        intent: "debater",
        sideIndex: 0,
      },
    });
    expect(occupied.statusCode).toBe(200);
    const first = apiContract.joinByCode.response.parse(occupied.json());
    const blocked = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: {
        code: creator.joinCode,
        displayName: "Blocked",
        intent: "debater",
        sideIndex: 0,
      },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      code: "SIDE_UNAVAILABLE",
      sideIndex: 0,
    });
    active.set(`debate-${creator.topicId}`, [
      {
        displayName: "Creator",
        identity: creator.participantIdentity,
        role: "spectator",
        sideIndex: null,
      },
      {
        displayName: "First",
        identity: first.participantIdentity,
        role: "debater",
        sideIndex: 0,
      },
    ]);
    const switched = await app.inject({
      method: "POST",
      url: `/api/topics/${creator.topicId}/join`,
      payload: {
        lobbyId: creator.topicId,
        previousToken: creator.token,
        displayName: "Creator",
        intent: "debater",
        sideIndex: 1,
      },
    });
    expect(switched.statusCode).toBe(200);
    expect(apiContract.join.response.parse(switched.json())).toMatchObject({
      participantIdentity: creator.participantIdentity,
      hostIdentity: creator.participantIdentity,
      isCreator: true,
      sideIndex: 1,
    });
    const foreignToken = await signed.issueToken({
      displayName: "Other",
      identity: creator.participantIdentity,
      role: "spectator",
      roomName: "debate-other",
      sideIndex: null,
    });
    const close = (token: string) =>
      app.inject({
        method: "POST",
        url: `/api/topics/${creator.topicId}/close`,
        payload: { lobbyId: creator.lobbyId, token },
      });
    expect((await close(foreignToken)).statusCode).toBe(401);
    expect((await close(first.token)).statusCode).toBe(403);
    expect((await close(creator.token)).statusCode).toBe(200);
    expect(removed).toContainEqual({
      roomName: `debate-${creator.topicId}`,
      identity: first.participantIdentity,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: apiContract.privateLobbyLookup.path,
          payload: { code: creator.joinCode },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rejects a role change after a private debate has started", async () => {
    const { gateway, issued } = fakeLiveKit();
    const privateLobbies = createMemoryPrivateLobbyStore([
      {
        id: "started-lobby",
        topicId: "dream-cheating",
        state: "DEBATE_IN_PROGRESS",
        codeHash: hashLobbyCode("STARTED1"),
        creatorIdentity: "creator-identity",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const app = await testApp(gateway, privateLobbies);
    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: {
        ...debaterInput,
        lobbyId: "started-lobby",
        previousToken: "creator-identity",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ROUND_ALREADY_STARTED" });
    const preview = await app.inject({
      method: "POST",
      url: apiContract.privateLobbyLookup.path,
      payload: { code: "STARTED1" },
    });
    expect(preview.json().sideAvailability).toEqual([false, false]);
    const newDebater = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: { code: "STARTED1", ...debaterInput },
    });
    expect(newDebater.statusCode).toBe(409);
    expect(newDebater.json()).toMatchObject({ code: "ROUND_ALREADY_STARTED" });
    const spectator = await app.inject({
      method: "POST",
      url: apiContract.joinByCode.path,
      payload: { code: "STARTED1", displayName: "Viewer", intent: "spectator" },
    });
    expect(spectator.statusCode).toBe(200);
    expect(issued).toEqual(["spectator"]);
  });

  it("rejects private codes for missing and expired lobbies", async () => {
    const { gateway } = fakeLiveKit();
    const privateLobbies = createMemoryPrivateLobbyStore([
      {
        id: "expired-lobby",
        topicId: "dream-cheating",
        state: "WAITING",
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
