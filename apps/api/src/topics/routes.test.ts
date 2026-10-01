import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { apiContract } from "../contracts.js";
import { openDatabase } from "../database.js";
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

function fakeLiveKit(tokenFor: (role: DebateRole) => string = (role) => role) {
  const active = new Map<string, RoomParticipant[]>();
  const issued: DebateRole[] = [];

  const gateway: LiveKitGateway = {
    async listParticipants(roomName) {
      return active.get(roomName) ?? [];
    },
    async issueToken({ role }) {
      issued.push(role);
      return tokenFor(role);
    },
  };

  return { active, gateway, issued };
}

async function testApp(livekit: LiveKitGateway) {
  const app = await buildApp({
    database: openDatabase(":memory:"),
    livekit,
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

  it("releases a pending debater reservation when its participant leaves", async () => {
    const { gateway } = fakeLiveKit();
    const app = await testApp(gateway);

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
      payload: { participantIdentity: join.participantIdentity },
    });

    expect(leaveResponse.statusCode).toBe(200);
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
