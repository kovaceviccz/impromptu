import { describe, expect, it } from "vitest";

import { calculateStatistics, createMemoryDebateResultStore } from "./store.js";

describe("debate statistics", () => {
  it("returns zero values for an account without debate history", async () => {
    const store = createMemoryDebateResultStore();
    await expect(store.statisticsFor("new-user")).resolves.toEqual({
      totalDebates: 0,
      wins: 0,
      losses: 0,
      winPercentage: 0,
    });
  });

  it("calculates wins, losses, draws, and percentage from recorded results", async () => {
    expect(calculateStatistics(["win", "loss", "win", "draw"])).toEqual({
      totalDebates: 4,
      wins: 2,
      losses: 1,
      winPercentage: 50,
    });
  });

  it("records each account once per lobby and reflects later results", async () => {
    const store = createMemoryDebateResultStore();
    const participants = [
      { accountId: "ada", sideIndex: 0 as const },
      { accountId: "grace", sideIndex: 1 as const },
    ];
    await store.recordResults("round-1", participants, 0);
    await store.recordResults("round-1", participants, 0);
    await store.recordResults("round-2", participants, 1);

    await expect(store.statisticsFor("ada")).resolves.toEqual({
      totalDebates: 2,
      wins: 1,
      losses: 1,
      winPercentage: 50,
    });
  });
});
