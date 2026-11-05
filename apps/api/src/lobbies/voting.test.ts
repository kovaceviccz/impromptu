import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPrivateLobbyStore } from "./store.js";
import { createMemoryPublicLobbyStateStore } from "./public-state.js";
import { votingSummary } from "./voting.js";

afterEach(() => vi.useRealTimers());

describe.each(["private", "public"] as const)("%s voting deadline", (kind) => {
  it("accepts votes and edits before the deadline and freezes totals at and after it", async () => {
    vi.useFakeTimers();
    const endsAt = "2026-11-02T12:00:30.000Z";
    const voting = {
      endsAt,
      eligible: ["spectator"],
      votes: {},
      debaterNames: { "0": "Ada", "1": "Grace" },
    };
    const privateStore = createMemoryPrivateLobbyStore([
      {
        id: "lobby",
        topicId: "topic",
        state: "VOTING",
        voting,
        creatorIdentity: "host",
        codeHash: null,
        createdAt: new Date(),
        expiresAt: null,
      },
    ]);
    const publicStore = createMemoryPublicLobbyStateStore([
      { topicId: "lobby", hostIdentity: "host", state: "VOTING", voting },
    ]);
    const store = kind === "private" ? privateStore : publicStore;
    const read = () =>
      kind === "private"
        ? privateStore.findById("lobby")
        : publicStore.find("lobby");
    vi.setSystemTime(Date.parse(endsAt) - 2);
    expect(await store.submitVote("lobby", "late-joiner", "0")).toBe(false);
    expect(await store.submitVote("lobby", "spectator", "0")).toBe(true);
    vi.setSystemTime(Date.parse(endsAt) - 1);
    expect(await store.submitVote("lobby", "spectator", "1")).toBe(true);
    expect(await store.submitVote("lobby", "spectator", "1")).toBe(true);
    expect(votingSummary((await read())?.voting).voteCounts).toEqual([0, 1]);
    for (const offset of [0, 1, 60_000]) {
      vi.setSystemTime(Date.parse(endsAt) + offset);
      expect(await store.submitVote("lobby", "spectator", "0")).toBe(false);
      expect(await store.submitVote("lobby", "spectator", null)).toBe(false);
      expect(await store.submitVote("lobby", "late-joiner", "0")).toBe(false);
      expect(votingSummary((await read())?.voting)).toMatchObject({
        voteCounts: [0, 1],
        results: {
          debaters: [
            { name: "Ada", votes: 0 },
            { name: "Grace", votes: 1 },
          ],
          winningSide: 1,
        },
      });
    }
  });
});

it("keeps results hidden until the authoritative voting deadline", () => {
  vi.useFakeTimers();
  const endsAt = "2026-11-04T12:00:30.000Z";
  const voting = {
    endsAt,
    eligible: ["viewer"],
    votes: { viewer: "0" as const },
    debaterNames: { "0": "Ada", "1": "Grace" },
  };
  vi.setSystemTime(Date.parse(endsAt) - 1);
  expect(votingSummary(voting).results).toBeNull();
  vi.setSystemTime(Date.parse(endsAt));
  expect(votingSummary(voting).results).toEqual({
    debaters: [
      { name: "Ada", votes: 1 },
      { name: "Grace", votes: 0 },
    ],
    winningSide: 0,
  });
});
