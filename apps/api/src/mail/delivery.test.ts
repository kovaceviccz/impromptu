import { afterEach, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createMemoryAccountStore } from "../accounts/store.js";
import { createMemoryPrivateLobbyStore } from "../lobbies/store.js";
import { SESSION_COOKIE } from "../accounts/routes.js";
import { linkEmail } from "./delivery.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
it("keeps captured mail private and exposes access only to configured mailbox readers", async () => {
  const accounts = createMemoryAccountStore();
  const created = await accounts.create({
    username: "reader",
    email: "reader@example.test",
    passwordHash: "unused",
  });
  if (!("account" in created)) throw new Error("Fixture account missing");
  const { token } = await accounts.createSession(created.account.id);
  const app = await buildApp({
    accounts,
    privateLobbies: createMemoryPrivateLobbyStore(),
    livekit: {
      async issueToken() {
        return "unused";
      },
      async verifyParticipantToken() {
        return undefined;
      },
      async listParticipants() {
        return [];
      },
      async removeParticipant() {},
      async updateRoomMetadata() {},
      async broadcastData() {},
    },
    livekitPublicUrl: "ws://localhost:7880",
    tokenTtlSeconds: 60,
    mailpitUrl: "http://127.0.0.1:1",
    mailboxAccountIds: [created.account.id],
  });
  apps.push(app);
  expect((await app.inject({ method: "GET", url: "/mail/" })).statusCode).toBe(
    403,
  );
  const cookies = { [SESSION_COOKIE]: token };
  expect(
    (
      await app.inject({ method: "GET", url: "/api/auth/session", cookies })
    ).json().account.mailboxAccess,
  ).toBe(true);
  expect(
    (
      await app.inject({
        method: "GET",
        url: "/mail/",
        cookies,
        headers: { origin: "https://unrelated.example" },
      })
    ).statusCode,
  ).toBe(403);
});
it("escapes user content in the shared HTML email while keeping a plain text alternative", () => {
  const email = linkEmail(
    "teacher@example.test",
    "Join",
    '<script>alert("hello")</script>',
    "https://example.test/invite#token=abc",
  );
  expect(email.html).not.toContain("<script>");
  expect(email.html).toContain("&lt;script&gt;");
  expect(email.text).toContain("https://example.test/invite#token=abc");
});
