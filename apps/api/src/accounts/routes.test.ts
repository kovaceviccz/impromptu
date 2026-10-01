import type { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { apiContract } from "../contracts.js";
import { openDatabase } from "../database.js";
import type { LiveKitGateway } from "../topics/livekit.js";
import { SESSION_COOKIE } from "./routes.js";

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
  async issueToken() {
    return "token";
  },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function testApp(database: DatabaseSync = openDatabase(":memory:")) {
  const app = await buildApp({
    database,
    livekit,
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
    const database = openDatabase(":memory:");
    const app = await testApp(database);

    const response = await register(app);

    expect(response.statusCode).toBe(201);
    const { account } = apiContract.register.response.parse(response.json());
    expect(account).toEqual({
      id: expect.any(String),
      username: "ada_lovelace",
      email: "ada@example.com",
      createdAt: expect.any(String),
    });
    const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(cookie).toEqual(
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "Lax" }),
    );

    const stored = database
      .prepare("SELECT password_hash FROM accounts WHERE id = ?")
      .get(account.id);
    expect(stored?.password_hash).toMatch(/^scrypt\$/);
    expect(stored?.password_hash).not.toContain(registration.password);

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
      const database = openDatabase(":memory:");
      const app = await testApp(database);

      const response = await register(app, payload);

      expect(response.statusCode).toBe(400);
      expect(apiContract.register.errors[400].parse(response.json())).toEqual({
        message: "Check the highlighted fields.",
        fieldErrors,
      });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM accounts").get(),
      ).toEqual({ count: 0 });
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
    const database = openDatabase(":memory:");
    const firstApp = await testApp(database);
    const cookies = sessionCookie(await register(firstApp));
    await firstApp.close();

    const secondApp = await testApp(database);
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
