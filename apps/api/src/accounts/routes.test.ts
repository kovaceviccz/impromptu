import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { apiContract } from "../contracts.js";
import { createMemoryPrivateLobbyStore } from "../lobbies/store.js";
import type { LiveKitGateway } from "../topics/livekit.js";
import { SESSION_COOKIE } from "./routes.js";
import { type AccountStore, createMemoryAccountStore } from "./store.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const registration = {
  username: "ada_lovelace",
  email: "Ada@Example.com",
  password: "analytical-engine",
} as const;

const livekit: LiveKitGateway = {
  async listParticipants() {
    return [];
  },
  async removeParticipant() {},
  async issueToken() {
    return "token";
  },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function testApp(accounts: AccountStore = createMemoryAccountStore()) {
  const app = await buildApp({
    accounts,
    livekit,
    privateLobbies: createMemoryPrivateLobbyStore(),
    livekitPublicUrl: "ws://localhost:7880",
    tokenTtlSeconds: 60,
  });
  apps.push(app);
  return app;
}

function sessionCookie(response: {
  cookies: { name: string; value: string }[];
}) {
  const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
  expect(cookie?.value).toBeTruthy();
  return { [SESSION_COOKIE]: cookie!.value };
}

function register(
  app: Awaited<ReturnType<typeof testApp>>,
  payload: object = registration,
) {
  return app.inject({ method: "POST", url: "/api/auth/register", payload });
}

describe("registration", () => {
  it("creates an account, starts a session, and never stores the plain password", async () => {
    const accounts = createMemoryAccountStore();
    const app = await testApp(accounts);

    const response = await register(app);

    expect(response.statusCode).toBe(201);
    const { account } = apiContract.register.response.parse(response.json());
    expect(account).toEqual({
      id: expect.any(String),
      displayName: "ada_lovelace",
      username: "ada_lovelace",
      email: "ada@example.com",
      createdAt: expect.any(String),
    });
    const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(cookie).toEqual(
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "Lax" }),
    );

    const stored = await accounts.findCredentials(account.username);
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(registration.password);

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      cookies: sessionCookie(response),
    });
    expect(apiContract.session.response.parse(session.json())).toEqual({
      account,
    });
  });

  it.each([
    [
      "a missing username",
      { email: registration.email, password: registration.password },
      { username: "Enter a username." },
    ],
    [
      "a malformed email",
      { ...registration, email: "not-an-email" },
      { email: "Enter a valid email address." },
    ],
    [
      "a short password",
      { ...registration, password: "short" },
      { password: "Password must be at least 8 characters." },
    ],
    [
      "an invalid username",
      { ...registration, username: "ada lovelace" },
      { username: "Use only letters, numbers, and underscores." },
    ],
  ])(
    "rejects %s without creating an account",
    async (_case, payload, fieldErrors) => {
      const accounts = createMemoryAccountStore();
      const app = await testApp(accounts);

      const response = await register(app, payload);

      expect(response.statusCode).toBe(400);
      expect(apiContract.register.errors[400].parse(response.json())).toEqual({
        message: "Check the highlighted fields.",
        fieldErrors,
      });
      for (const identifier of ["ada_lovelace", "ada@example.com"]) {
        expect(await accounts.findCredentials(identifier)).toBeUndefined();
      }
      expect(response.cookies).toEqual([]);
    },
  );

  it("rejects a duplicate username or email regardless of case", async () => {
    const app = await testApp();
    expect((await register(app)).statusCode).toBe(201);

    const duplicateUsername = await register(app, {
      ...registration,
      username: "ADA_LOVELACE",
      email: "someone@example.com",
    });
    const duplicateEmail = await register(app, {
      ...registration,
      username: "someone_else",
      email: "ada@EXAMPLE.com",
    });
    const duplicateBoth = await register(app);

    expect(
      [duplicateUsername, duplicateEmail, duplicateBoth].map(
        (response) => response.statusCode,
      ),
    ).toEqual([409, 409, 409]);
    expect(
      apiContract.register.errors[409].parse(duplicateUsername.json()),
    ).toEqual({
      message: "An account with these details already exists.",
      fieldErrors: { username: "This username is already taken." },
    });
    expect(
      apiContract.register.errors[409].parse(duplicateEmail.json()),
    ).toEqual({
      message: "An account with these details already exists.",
      fieldErrors: {
        email: "An account with this email address already exists.",
      },
    });
    expect(
      apiContract.register.errors[409].parse(duplicateBoth.json()).fieldErrors,
    ).toEqual({
      email: "An account with this email address already exists.",
      username: "This username is already taken.",
    });
  });
});

describe("login", () => {
  it.each([
    ["username", "ada_lovelace"],
    ["email", "ADA@example.com"],
  ])(
    "authenticates with a valid %s and keeps the session across requests",
    async (_kind, identifier) => {
      const app = await testApp();
      await register(app);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { identifier, password: registration.password },
      });

      expect(response.statusCode).toBe(200);
      const { account } = apiContract.login.response.parse(response.json());
      expect(account.username).toBe("ada_lovelace");
      const cookies = sessionCookie(response);

      for (let visit = 0; visit < 2; visit += 1) {
        const protectedResponse = await app.inject({
          method: "GET",
          url: "/api/account",
          cookies,
        });
        expect(protectedResponse.statusCode).toBe(200);
        expect(
          apiContract.account.response.parse(protectedResponse.json()),
        ).toEqual({ account });
      }
    },
  );

  it.each([
    ["an incorrect password", "ada_lovelace", "wrong-password"],
    ["an unknown account", "nobody", registration.password],
  ])("denies access with %s", async (_case, identifier, password) => {
    const app = await testApp();
    await register(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { identifier, password },
    });

    expect(response.statusCode).toBe(401);
    expect(apiContract.login.errors[401].parse(response.json())).toEqual({
      message: "Incorrect username, email, or password.",
    });
    expect(response.cookies).toEqual([]);
  });

  it("reports missing login fields", async () => {
    const app = await testApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { identifier: " ", password: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(apiContract.login.errors[400].parse(response.json())).toEqual({
      message: "Check the highlighted fields.",
      fieldErrors: {
        identifier: "Enter your username or email.",
        password: "Enter your password.",
      },
    });
  });
});

describe("sessions", () => {
  it("protects account-only routes from guests and forged sessions", async () => {
    const app = await testApp();

    const guest = await app.inject({ method: "GET", url: "/api/account" });
    const forged = await app.inject({
      method: "GET",
      url: "/api/account",
      cookies: { [SESSION_COOKIE]: "forged-token" },
    });
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(guest.statusCode).toBe(401);
    expect(apiContract.account.errors[401].parse(guest.json())).toEqual({
      message: "Log in to continue.",
    });
    expect(forged.statusCode).toBe(401);
    expect(apiContract.session.response.parse(session.json())).toEqual({
      account: null,
    });
  });

  it("persists sessions across application restarts", async () => {
    const accounts = createMemoryAccountStore();
    const firstApp = await testApp(accounts);
    const cookies = sessionCookie(await register(firstApp));
    await firstApp.close();

    const secondApp = await testApp(accounts);
    const response = await secondApp.inject({
      method: "GET",
      url: "/api/account",
      cookies,
    });

    expect(response.statusCode).toBe(200);
  });

  it("ends the session on logout", async () => {
    const app = await testApp();
    const cookies = sessionCookie(await register(app));

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies,
    });
    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/account",
      cookies,
    });

    expect(logout.statusCode).toBe(200);
    expect(
      logout.cookies.find(({ name }) => name === SESSION_COOKIE)?.value,
    ).toBe("");
    expect(afterLogout.statusCode).toBe(401);
  });
});

describe("account management", () => {
  it("updates the signed-in account and preserves its session", async () => {
    const app = await testApp();
    const cookies = sessionCookie(await register(app));

    const response = await app.inject({
      method: "PATCH",
      url: apiContract.updateAccount.path,
      cookies,
      payload: {
        displayName: "Ada Byron",
        username: "ada_byron",
        email: "BYRON@example.com",
      },
    });

    expect(response.statusCode).toBe(200);
    const { account } = apiContract.updateAccount.response.parse(
      response.json(),
    );
    expect(account).toEqual(
      expect.objectContaining({
        displayName: "Ada Byron",
        username: "ada_byron",
        email: "byron@example.com",
      }),
    );

    const session = await app.inject({
      method: "GET",
      url: apiContract.session.path,
      cookies,
    });
    expect(apiContract.session.response.parse(session.json())).toEqual({
      account,
    });
  });

  it("allows unchanged details and rejects another account's details", async () => {
    const app = await testApp();
    const firstCookies = sessionCookie(await register(app));
    await register(app, {
      username: "grace_hopper",
      email: "grace@example.com",
      password: "compiler-pioneer",
    });

    const unchanged = await app.inject({
      method: "PATCH",
      url: apiContract.updateAccount.path,
      cookies: firstCookies,
      payload: {
        displayName: "Ada Lovelace",
        username: registration.username,
        email: registration.email,
      },
    });
    const duplicate = await app.inject({
      method: "PATCH",
      url: apiContract.updateAccount.path,
      cookies: firstCookies,
      payload: {
        displayName: "Grace Hopper",
        username: "GRACE_HOPPER",
        email: "GRACE@example.com",
      },
    });

    expect(unchanged.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(409);
    expect(
      apiContract.updateAccount.errors[409].parse(duplicate.json()).fieldErrors,
    ).toEqual({
      email: "An account with this email address already exists.",
      username: "This username is already taken.",
    });
  });

  it("validates updates and requires a session", async () => {
    const app = await testApp();
    const cookies = sessionCookie(await register(app));

    const invalid = await app.inject({
      method: "PATCH",
      url: apiContract.updateAccount.path,
      cookies,
      payload: { displayName: "", username: "x", email: "invalid" },
    });
    const guest = await app.inject({
      method: "PATCH",
      url: apiContract.updateAccount.path,
      payload: {
        displayName: "Valid Name",
        username: "valid_name",
        email: "valid@example.com",
      },
    });

    expect(invalid.statusCode).toBe(400);
    expect(
      apiContract.updateAccount.errors[400].parse(invalid.json()).fieldErrors,
    ).toEqual({
      displayName: "Enter a display name.",
      email: "Enter a valid email address.",
      username: "Username must be at least 3 characters.",
    });
    expect(guest.statusCode).toBe(401);
  });

  it("deletes the account, all sessions, and the current cookie", async () => {
    const accounts = createMemoryAccountStore();
    const app = await testApp(accounts);
    const cookies = sessionCookie(await register(app));

    const response = await app.inject({
      method: "DELETE",
      url: apiContract.deleteAccount.path,
      cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(apiContract.deleteAccount.response.parse(response.json())).toEqual({
      status: "ok",
    });
    expect(
      response.cookies.find(({ name }) => name === SESSION_COOKIE)?.value,
    ).toBe("");
    expect(await accounts.findCredentials(registration.email)).toBeUndefined();

    const afterDeletion = await app.inject({
      method: "GET",
      url: apiContract.account.path,
      cookies,
    });
    expect(afterDeletion.statusCode).toBe(401);
  });

  it("does not allow guests to delete accounts", async () => {
    const app = await testApp();
    const response = await app.inject({
      method: "DELETE",
      url: apiContract.deleteAccount.path,
    });
    expect(response.statusCode).toBe(401);
  });
});
