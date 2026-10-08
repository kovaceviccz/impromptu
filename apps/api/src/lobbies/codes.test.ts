import { describe, expect, it } from "vitest";

import { createPrivateLobby, hashLobbyCode } from "./codes.js";
import { createMemoryPrivateLobbyStore } from "./store.js";

describe("private lobby codes", () => {
  it("generates distinct active codes and stores only their hashes", async () => {
    const store = createMemoryPrivateLobbyStore();
    const lobbies = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        createPrivateLobby(store, "dream-cheating", `creator-${index}`),
      ),
    );
    expect(new Set(lobbies.map(({ code }) => code)).size).toBe(20);
    for (const lobby of lobbies) {
      expect(lobby.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      const persisted = await store.findById(lobby.id);
      expect(persisted?.codeHash).toBe(hashLobbyCode(lobby.code));
      expect(persisted?.state).toBe("WAITING");
      expect(persisted).not.toHaveProperty("code");
    }
  });

  it("retries a collision even when two creations race", async () => {
    const store = createMemoryPrivateLobbyStore();
    const codes = ["ABCD2345", "ABCD2345", "EFGH6789"];
    const nextCode = () => codes.shift()!;
    const lobbies = await Promise.all([
      createPrivateLobby(store, "dream-cheating", "creator-one", nextCode),
      createPrivateLobby(store, "dream-cheating", "creator-two", nextCode),
    ]);
    expect(lobbies.map(({ code }) => code).sort()).toEqual([
      "ABCD2345",
      "EFGH6789",
    ]);
    expect(lobbies[0]?.id).not.toBe(lobbies[1]?.id);
  });
});
