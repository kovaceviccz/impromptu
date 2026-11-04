import { describe, expect, it } from "vitest";

import { ChatPolicy } from "./policy.js";

describe("ChatPolicy", () => {
  it("limits each participant independently and permits messages after cooldown", () => {
    let now = 1_000;
    const policy = new ChatPolicy(() => now);

    for (let index = 0; index < 5; index += 1) {
      expect(policy.check("room", "alice", `message ${index}`)).toEqual({
        allowed: true,
      });
    }
    expect(policy.check("room", "alice", "message 6")).toMatchObject({
      allowed: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: 10,
    });
    expect(policy.check("room", "bob", "Bob can still speak")).toEqual({
      allowed: true,
    });

    now += 10_000;
    expect(policy.check("room", "alice", "Allowed after cooldown")).toEqual({
      allowed: true,
    });
  });

  it("blocks consecutive duplicates after normalization", () => {
    const policy = new ChatPolicy();
    expect(policy.check("room", "alice", "Hello, room!")).toEqual({
      allowed: true,
    });
    expect(policy.check("room", "alice", "  hello room  ")).toMatchObject({
      allowed: false,
      code: "DUPLICATE_MESSAGE",
    });
    expect(policy.check("room", "bob", "hello room")).toEqual({
      allowed: true,
    });
    expect(policy.check("another-room", "alice", "hello room")).toEqual({
      allowed: true,
    });
  });

  it("does not treat different emoji messages as duplicates", () => {
    const policy = new ChatPolicy();
    expect(policy.check("room", "alice", "👍")).toEqual({ allowed: true });
    expect(policy.check("room", "alice", "👎")).toEqual({ allowed: true });
  });

  it("does not count rejected attempts toward the accepted-message limit", () => {
    const policy = new ChatPolicy();
    expect(policy.check("room", "alice", "first")).toEqual({ allowed: true });
    for (let index = 0; index < 4; index += 1) {
      expect(policy.check("room", "alice", "first")).toMatchObject({
        allowed: false,
        code: "DUPLICATE_MESSAGE",
      });
    }
    expect(policy.check("room", "alice", "different")).toEqual({
      allowed: true,
    });
    expect(policy.check("room", "alice", "sh1t")).toMatchObject({
      allowed: false,
      code: "INAPPROPRIATE_LANGUAGE",
    });
    expect(policy.check("room", "alice", "corrected message")).toEqual({
      allowed: true,
    });
  });

  it.each([
    "FUCK",
    "f.u.c.k",
    "f u c k",
    "sh1t",
    "sh!t",
    "biiitch",
    "d1ck",
    "d!ckhead",
    "a55hole",
    "f4gg0t",
    "n1gg3r",
    "p.u.s.s.y",
    "mother-f-u-c-k-e-r",
    "fücking",
    "f​u​c​k",
  ])("blocks a normalized bypass attempt: %s", (message) => {
    expect(new ChatPolicy().check("room", "alice", message)).toMatchObject({
      allowed: false,
      code: "INAPPROPRIATE_LANGUAGE",
    });
  });

  it.each([
    "A classical argument",
    "Hello everyone",
    "Passionate debate",
    "Scunthorpe is a place",
    "Please assess the argument",
  ])(
    "allows valid language without substring false positives: %s",
    (message) => {
      expect(new ChatPolicy().check("room", "alice", message)).toEqual({
        allowed: true,
      });
    },
  );
});
