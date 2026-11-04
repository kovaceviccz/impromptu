import {
  createMemoryPublicLobbyStateStore,
  type PublicLobbyStateStore,
} from "../lobbies/public-state.js";
import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import { apiContract } from "../contracts.js";
import { createMemoryAccountStore } from "../accounts/store.js";
import type { AccountStore } from "../accounts/store.js";
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
import {
  createMemoryDebateResultStore,
  type DebateResultStore,
} from "../statistics/store.js";
import { SESSION_COOKIE } from "../accounts/routes.js";

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
  const broadcasts: { roomName: string; data: Uint8Array; topic: string }[] =
    [];

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
    async broadcastData(roomName, data, topic) {
      broadcasts.push({ roomName, data, topic });
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
    broadcasts,
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
  options: {
    publicLobbyState?: PublicLobbyStateStore;
    accounts?: AccountStore;
    debateResults?: DebateResultStore;
  } = {},
) {
  const app = await buildApp({
    publicLobbyState: options.publicLobbyState,
    accounts: options.accounts ?? createMemoryAccountStore(),
    debateResults: options.debateResults ?? createMemoryDebateResultStore(),
    livekit,
    privateLobbies,
    livekitPublicUrl: "ws://localhost:7880",
    tokenTtlSeconds: 60,
  });
  apps.push(app);
  return app;
}

describe("API contracts", () => {
  it("uses the authenticated account as the participant identity", async () => {
    const accounts = createMemoryAccountStore();
    const created = await accounts.create({
      username: "signed_in_debater",
      email: "debater@example.com",
      passwordHash: "test-only-hash",
    });
    if ("duplicates" in created) throw new Error("Account creation failed");
    const session = await accounts.createSession(created.account.id);
    const { gateway } = fakeLiveKit();
    const app = await testApp(gateway, createMemoryPrivateLobbyStore(), {
      accounts,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      cookies: { [SESSION_COOKIE]: session.token },
      payload: {
        displayName: "Signed in debater",
        intent: "debater",
        sideIndex: 0,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().participantIdentity).toBe(created.account.id);
  });

  it("moderates authenticated spectator chat before broadcasting it", async () => {
    const { active, broadcasts, gateway } = fakeLiveKit();
    active.set("debate-dream-cheating", [
      {
        displayName: "Alice",
        identity: "alice-id",
        role: "spectator",
        sideIndex: null,
      },
    ]);
    const app = await testApp(gateway);
    const contract = apiContract.sendChatMessage;
    const url = contract.path.replace(":topicId", "dream-cheating");

    const accepted = await app.inject({
      method: contract.method,
      url,
      payload: {
        lobbyId: "dream-cheating",
        message: "A valid contribution",
        token: "alice-id",
      },
    });
    expect(accepted.statusCode).toBe(200);
    const message = contract.response.parse(accepted.json());
    expect(message).toMatchObject({
      message: "A valid contribution",
      senderIdentity: "alice-id",
      senderName: "Alice",
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      roomName: "debate-dream-cheating",
      topic: "impromptu.chat",
    });
    expect(
      contract.response.parse(
        JSON.parse(new TextDecoder().decode(broadcasts[0]!.data)),
      ),
    ).toEqual(message);

    const inappropriate = await app.inject({
      method: contract.method,
      url,
      payload: {
        lobbyId: "dream-cheating",
        message: "f.u.c.k",
        token: "alice-id",
      },
    });
    expect(inappropriate.statusCode).toBe(400);
    expect(inappropriate.json()).toMatchObject({
      code: "INAPPROPRIATE_LANGUAGE",
      message: expect.stringContaining("not allowed"),
    });
    expect(broadcasts).toHaveLength(1);
  });

  it("rejects duplicate chat and identities that are not active spectators", async () => {
    const { active, broadcasts, gateway } = fakeLiveKit();
    active.set("debate-dream-cheating", [
      {
        displayName: "Alice",
        identity: "alice-id",
        role: "spectator",
        sideIndex: null,
      },
      {
        displayName: "Debater",
        identity: "debater-id",
        role: "debater",
        sideIndex: 0,
      },
    ]);
    const app = await testApp(gateway);
    const contract = apiContract.sendChatMessage;
    const url = contract.path.replace(":topicId", "dream-cheating");
    const payload = {
      lobbyId: "dream-cheating",
      message: "First thought",
      token: "alice-id",
    };

    expect(
      (await app.inject({ method: contract.method, url, payload })).statusCode,
    ).toBe(200);
    const duplicate = await app.inject({
      method: contract.method,
      url,
      payload: { ...payload, message: " first thought! " },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "DUPLICATE_MESSAGE" });

    const debater = await app.inject({
      method: contract.method,
      url,
      payload: { ...payload, message: "Debater bypass", token: "debater-id" },
    });
    expect(debater.statusCode).toBe(403);
    const absent = await app.inject({
      method: contract.method,
      url,
      payload: { ...payload, message: "Absent bypass", token: "absent-id" },
    });
    expect(absent.statusCode).toBe(403);
    expect(broadcasts).toHaveLength(1);
  });

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
    const startedLobbyId = "45b22393-98f5-41af-a259-7ea625a4e01e";
    const privateLobbies = createMemoryPrivateLobbyStore([
      {
        id: startedLobbyId,
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
        lobbyId: startedLobbyId,
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
    const lobbies = createMemoryPrivateLobbyStore();
    const lookup = vi.spyOn(lobbies, "findById");
    const app = await testApp(gateway, lobbies);

    const response = await app.inject({
      method: "POST",
      url: "/api/topics/not-a-topic/join",
      payload: debaterInput,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Topic not found" });
    expect(lookup).not.toHaveBeenCalled();

    const invalidLobby = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { intent: "spectator", lobbyId: "not-a-uuid" },
    });
    expect(invalidLobby.statusCode).toBe(404);
    expect(invalidLobby.json()).toEqual({ message: "Lobby not found" });
    expect(lookup).not.toHaveBeenCalled();
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
    expect(claims.video?.canPublishData).toBe(false);
    expect(claims.video?.canUpdateOwnMetadata).toBe(true);
    expect(claims.name).toBe("Test spectator");
  });

  it.each(["debater", "spectator"] as const)(
    "prevents ineligible %s participants from writing vote metadata",
    async (role) => {
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
        role,
        canVote: false,
        roomName: "debate-dream-cheating",
        sideIndex: role === "debater" ? 0 : null,
      });
      const claims = await new TokenVerifier(apiKey, apiSecret).verify(token);

      expect(claims.video?.canPublish).toBe(role === "debater");
      expect(claims.video?.canPublishData).toBe(false);
      expect(claims.video?.canUpdateOwnMetadata).toBe(false);
      expect(claims.attributes?.["debate.side"]).toBe(
        role === "debater" ? "0" : undefined,
      );
    },
  );
});

describe("ending rounds", () => {
  const lobbyId = "a5ca122c-e3a2-4dc3-aa8a-8a3c9aac5215";
  const creatorIdentity = "892203fc-0be5-43cb-a4ae-383bf226e947";
  async function activeLobby(roundEndsAt: Date | null = null) {
    const livekit = fakeLiveKit();
    const store = createMemoryPrivateLobbyStore([
      {
        id: lobbyId,
        topicId: "dream-cheating",
        state: "DEBATE_IN_PROGRESS",
        creatorIdentity,
        codeHash: "test",
        createdAt: new Date(),
        expiresAt: null,
        roundEndsAt,
      },
    ]);
    const app = await testApp(livekit.gateway, store);
    return { app, store, ...livekit };
  }
  it("persists the timer chosen when starting and prevents manual ending", async () => {
    const { app, store, active } = await activeLobby();
    await store.updateState(lobbyId, "DEBATE_IN_PROGRESS", "WAITING");
    active.set(`debate-${lobbyId}`, [
      {
        identity: creatorIdentity,
        displayName: "Creator",
        role: "spectator",
        sideIndex: null,
      },
      {
        identity: "side-0",
        displayName: "First",
        role: "debater",
        sideIndex: 0,
      },
      {
        identity: "side-1",
        displayName: "Second",
        role: "debater",
        sideIndex: 1,
      },
    ]);
    const before = Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/start",
      payload: { lobbyId, token: creatorIdentity, durationSeconds: 60 },
    });
    expect(response.statusCode).toBe(200);
    expect(
      (await store.findById(lobbyId))?.roundEndsAt?.getTime(),
    ).toBeGreaterThanOrEqual(before + 60_000);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/end-round",
          payload: { lobbyId, token: creatorIdentity },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("allows only the creator and rejects concurrent and repeated requests", async () => {
    const { app, store, roomMetadata } = await activeLobby();
    const send = (token: string) =>
      app.inject({
        method: "POST",
        url: "/api/topics/dream-cheating/end-round",
        payload: { lobbyId, token },
      });
    expect((await send("someone-else")).statusCode).toBe(403);
    expect((await store.findById(lobbyId))?.state).toBe("DEBATE_IN_PROGRESS");
    const responses = await Promise.all([
      send(creatorIdentity),
      send(creatorIdentity),
    ]);
    expect(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect((await send(creatorIdentity)).statusCode).toBe(409);
    expect((await store.findById(lobbyId))?.state).toBe("VOTING");
    expect(roomMetadata.get(`debate-${lobbyId}`)).toBe("VOTING");
    const status = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/participants",
      payload: { lobbyId, token: "reconnecting-participant" },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().state).toBe("VOTING");
  });
  it("rejects manual ending for timed rounds and automatically ends expired deadlines", async () => {
    const { app, store } = await activeLobby(new Date(Date.now() + 60_000));
    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/end-round",
      payload: { lobbyId, token: creatorIdentity },
    });
    expect(response.statusCode).toBe(409);
    await store.updateState(
      lobbyId,
      "DEBATE_IN_PROGRESS",
      "DEBATE_IN_PROGRESS",
      new Date(0),
    );
    await vi.waitFor(
      async () => expect((await store.findById(lobbyId))?.state).toBe("VOTING"),
      { timeout: 2500 },
    );
  });

  it("opens a 30-second voting window and rejects stale submissions after closing", async () => {
    const { app, store, active } = await activeLobby();
    active.set(`debate-${lobbyId}`, [
      {
        identity: "spectator",
        displayName: "Viewer",
        role: "spectator",
        sideIndex: null,
      },
    ]);
    const before = Date.now();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/end-round",
          payload: { lobbyId, token: creatorIdentity },
        })
      ).statusCode,
    ).toBe(200);
    const voting = (await store.findById(lobbyId))!.voting!;
    expect(Date.parse(voting.endsAt)).toBeGreaterThanOrEqual(before + 30_000);
    expect(Date.parse(voting.endsAt)).toBeLessThanOrEqual(Date.now() + 30_000);
    const send = (choice: "0" | "1" | null, token = "spectator") =>
      app.inject({
        method: "POST",
        url: "/api/topics/dream-cheating/vote",
        payload: { lobbyId, token, choice },
      });
    expect((await send("0", creatorIdentity)).statusCode).toBe(409);
    expect((await send("0")).json()).toMatchObject({
      voteCounts: [1, 0],
      selectedVote: "0",
    });
    await store.updateState(lobbyId, "VOTING", "VOTING", undefined, {
      ...(await store.findById(lobbyId))!.voting!,
      endsAt: new Date(0).toISOString(),
    });
    expect((await send("1")).statusCode).toBe(409);
    expect((await send(null)).statusCode).toBe(409);
    active.set(`debate-${lobbyId}`, []);
    const status = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/participants",
      payload: { lobbyId, token: "spectator" },
    });
    expect(status.json()).toMatchObject({
      votingEndsAt: new Date(0).toISOString(),
      voteCounts: [1, 0],
      selectedVote: "0",
    });
  });

  it.each<{
    votes: Record<string, "0" | "1">;
    counts: [number, number];
    winningSide: 0 | 1 | null;
    wins: [number, number];
    losses: [number, number];
  }>([
    {
      votes: { spectator: "0" },
      counts: [1, 0],
      winningSide: 0,
      wins: [1, 0],
      losses: [0, 1],
    },
    {
      votes: { spectator: "1", other: "1" },
      counts: [0, 2],
      winningSide: 1,
      wins: [0, 1],
      losses: [1, 0],
    },
    {
      votes: { spectator: "0", other: "1" },
      counts: [1, 1],
      winningSide: null,
      wins: [0, 0],
      losses: [0, 0],
    },
    {
      votes: {},
      counts: [0, 0],
      winningSide: null,
      wins: [0, 0],
      losses: [0, 0],
    },
  ])(
    "finalizes results consistently for both clients with totals $counts",
    async ({ votes, counts, winningSide, wins, losses }) => {
      const debateResults = createMemoryDebateResultStore();
      const livekit = fakeLiveKit();
      const store = createMemoryPrivateLobbyStore([
        {
          id: lobbyId,
          topicId: "dream-cheating",
          state: "DEBATE_IN_PROGRESS",
          creatorIdentity,
          codeHash: "test",
          createdAt: new Date(),
          expiresAt: null,
          roundEndsAt: null,
        },
      ]);
      livekit.active.set(`debate-${lobbyId}`, [
        {
          identity: "side-0-account",
          displayName: "First",
          role: "debater",
          sideIndex: 0,
        },
        {
          identity: "side-1-account",
          displayName: "Second",
          role: "debater",
          sideIndex: 1,
        },
        {
          identity: "spectator",
          displayName: "Viewer",
          role: "spectator",
          sideIndex: null,
        },
      ]);
      const app = await testApp(livekit.gateway, store, { debateResults });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/topics/dream-cheating/end-round",
            payload: { lobbyId, token: creatorIdentity },
          })
        ).statusCode,
      ).toBe(200);
      const voting = (await store.findById(lobbyId))!.voting!;
      await store.updateState(lobbyId, "VOTING", "VOTING", undefined, {
        ...voting,
        endsAt: new Date(0).toISOString(),
        votes,
      });

      await vi.waitFor(
        async () =>
          expect((await store.findById(lobbyId))?.state).toBe("ENDED"),
        { timeout: 2500 },
      );
      await expect(
        debateResults.statisticsFor("side-0-account"),
      ).resolves.toMatchObject({
        totalDebates: 1,
        wins: wins[0],
        losses: losses[0],
      });
      await expect(
        debateResults.statisticsFor("side-1-account"),
      ).resolves.toMatchObject({
        totalDebates: 1,
        wins: wins[1],
        losses: losses[1],
      });
      expect(livekit.roomMetadata.get(`debate-${lobbyId}`)).toBe("ENDED");
      livekit.active.set(`debate-${lobbyId}`, []);
      for (const token of [creatorIdentity, "spectator"]) {
        const response = await app.inject({
          method: "POST",
          url: "/api/topics/dream-cheating/participants",
          payload: { lobbyId, token },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          state: "ENDED",
          results: {
            debaters: [
              { name: "First", votes: counts[0] },
              { name: "Second", votes: counts[1] },
            ],
            winningSide,
          },
        });
      }
    },
  );

  it("marks spectators joining during voting ineligible and restricts their token", async () => {
    const { store } = await activeLobby();
    const lobby = (await store.findById(lobbyId))!;
    const livekit = fakeLiveKit();
    const issueToken = vi.spyOn(livekit.gateway, "issueToken");
    const app = await testApp(
      livekit.gateway,
      createMemoryPrivateLobbyStore([
        { ...lobby, state: "VOTING", visibility: "public" },
      ]),
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/topics/dream-cheating/join",
      payload: { lobbyId, intent: "spectator" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "VOTING",
      voteEligible: false,
    });
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({ canVote: false }),
    );
  });
});

describe.each(["starter", "created"] as const)(
  "reopening %s public lobbies",
  (kind) => {
    async function completedLobby() {
      const id =
        kind === "starter"
          ? "dream-cheating"
          : "de442318-535a-4007-a26d-553652066baf";
      const voting = {
        roundId: "previous-round",
        endsAt: new Date(0).toISOString(),
        eligible: ["viewer"],
        votes: { viewer: "0" as const },
        debaterNames: { "0": "First", "1": "Second" },
      };
      const privateStore = createMemoryPrivateLobbyStore(
        kind === "created"
          ? [
              {
                id,
                topicId: id,
                name: "Reusable public topic",
                side0: "Yes",
                side1: "No",
                visibility: "public",
                state: "ENDED",
                voting,
                roundEndsAt: new Date(0),
                creatorIdentity: "viewer",
                codeHash: null,
                createdAt: new Date(),
                expiresAt: null,
              },
            ]
          : [],
      );
      const publicStore = createMemoryPublicLobbyStateStore([
        {
          topicId: id,
          hostIdentity: "viewer",
          state: "ENDED",
          voting,
          roundEndsAt: new Date(0),
        },
      ]);
      const livekit = fakeLiveKit();
      const participants: RoomParticipant[] = [
        {
          identity: "a1000000-0000-4000-8000-000000000001",
          displayName: "First",
          role: "debater",
          sideIndex: 0,
        },
        {
          identity: "a1000000-0000-4000-8000-000000000002",
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
      ];
      livekit.active.set(`debate-${id}`, participants);
      const debateResults = createMemoryDebateResultStore();
      const app = await testApp(livekit.gateway, privateStore, {
        debateResults,
        publicLobbyState: publicStore,
      });
      const read = () =>
        kind === "starter" ? publicStore.find(id) : privateStore.findById(id);
      const card = async () =>
        (await app.inject({ method: "GET", url: "/api/topics" }))
          .json()
          .find((topic: { id: string }) => topic.id === id);
      return {
        id,
        voting,
        app,
        livekit,
        read,
        card,
        debateResults,
        expire: async () => {
          const current = (await read())!;
          const store = kind === "starter" ? publicStore : privateStore;
          await store.updateState(id, "VOTING", "VOTING", undefined, {
            ...current.voting!,
            endsAt: new Date(0).toISOString(),
            votes: { viewer: "0" },
          });
        },
      };
    }

    it("reopens after both debaters leave and starts the next round with fresh voting", async () => {
      const { id, voting, app, livekit, read, card, debateResults, expire } =
        await completedLobby();
      await debateResults.recordResults(
        voting.roundId,
        [
          { accountId: "a1000000-0000-4000-8000-000000000001", sideIndex: 0 },
          { accountId: "a1000000-0000-4000-8000-000000000002", sideIndex: 1 },
        ],
        0,
      );
      expect((await card()).sideAvailability).toEqual([false, false]);
      const leave = (token: string) =>
        app.inject({
          method: "POST",
          url: `/api/topics/${id}/leave`,
          payload: { lobbyId: id, token },
        });
      expect(
        (await leave("a1000000-0000-4000-8000-000000000001")).statusCode,
      ).toBe(200);
      expect((await read())?.state).toBe("ENDED");
      expect(
        (await leave("a1000000-0000-4000-8000-000000000002")).statusCode,
      ).toBe(200);
      expect((await card()).sideAvailability).toEqual([true, true]);
      expect(await read()).toMatchObject({
        state: "WAITING",
        roundEndsAt: null,
        voting,
      });
      expect(livekit.roomMetadata.get(`debate-${id}`)).toBe("WAITING");
      for (const sideIndex of [0, 1]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/topics/${id}/join`,
          payload: {
            lobbyId: id,
            intent: "debater",
            previousToken:
              sideIndex === 0
                ? "a1000000-0000-4000-8000-000000000001"
                : "a1000000-0000-4000-8000-000000000002",
            displayName: `Next ${sideIndex}`,
            sideIndex,
          },
        });
        expect(response.statusCode).toBe(200);
        const join = response.json();
        livekit.active.get(`debate-${id}`)!.push({
          identity: join.participantIdentity,
          displayName: join.displayName,
          role: "debater",
          sideIndex: join.sideIndex,
        });
      }
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/topics/${id}/start`,
            payload: { lobbyId: id, token: "viewer" },
          })
        ).statusCode,
      ).toBe(200);
      expect((await read())?.voting).toBeNull();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/topics/${id}/end-round`,
            payload: { lobbyId: id, token: "viewer" },
          })
        ).statusCode,
      ).toBe(200);
      const next = (await read())!.voting!;
      expect(next.roundId).not.toBe(voting.roundId);
      expect(next.votes).toEqual({});
      expect(next.eligible).toContain("viewer");
      await expire();
      await vi.waitFor(
        async () => expect((await read())?.state).toBe("ENDED"),
        { timeout: 2500 },
      );
      await expect(
        debateResults.statisticsFor("a1000000-0000-4000-8000-000000000001"),
      ).resolves.toMatchObject({ totalDebates: 2, wins: 2 });
    });

    it("recovers vacant positions after a disconnect without requiring a leave request", async () => {
      const { id, app, livekit, card } = await completedLobby();
      livekit.active.set(`debate-${id}`, [
        {
          identity: "viewer",
          displayName: "Viewer",
          role: "spectator",
          sideIndex: null,
        },
      ]);
      expect((await card()).sideAvailability).toEqual([true, true]);
      const status = await app.inject({
        method: "POST",
        url: `/api/topics/${id}/participants`,
        payload: { lobbyId: id, token: "viewer" },
      });
      expect(status.json()).toMatchObject({
        state: "WAITING",
        results: { winningSide: 0 },
      });
    });
  },
);
