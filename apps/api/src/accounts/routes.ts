import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

import { accountContracts } from "./contract.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import type { AccountStore } from "./store.js";

export const SESSION_COOKIE = "impromptu_session";

const duplicateMessages = {
  email: "An account with this email address already exists.",
  username: "This username is already taken.",
} as const;

export type AccountRoutesOptions = {
  accounts: AccountStore;
  secureCookies: boolean;
};

export const accountRoutes: FastifyPluginAsyncZod<
  AccountRoutesOptions
> = async (app, { accounts, secureCookies }) => {
  // Compared against when no account matches, so a missing account and a
  // wrong password take similar time.
  const unmatchedPasswordHash = hashPassword("unmatched-account-password");

  async function currentAccount(request: FastifyRequest) {
    const token = request.cookies[SESSION_COOKIE];
    return token ? accounts.findSessionAccount(token) : undefined;
  }

  async function startSession(reply: FastifyReply, accountId: string) {
    const { token, expiresAt } = await accounts.createSession(accountId);
    reply.setCookie(SESSION_COOKIE, token, {
      expires: expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (!error.validation || error.validationContext !== "body") throw error;

    const fieldErrors: Record<string, string> = {};
    for (const issue of error.validation) {
      const field = issue.instancePath.split("/")[1];
      if (field && !(field in fieldErrors)) {
        fieldErrors[field] = issue.message ?? "Enter a valid value.";
      }
    }
    return reply
      .code(400)
      .send({ message: "Check the highlighted fields.", fieldErrors });
  });

  app.post(
    accountContracts.register.path,
    {
      schema: {
        body: accountContracts.register.body,
        response: {
          201: accountContracts.register.response,
          400: accountContracts.register.errors[400],
          409: accountContracts.register.errors[409],
        },
      },
    },
    async (request, reply) => {
      const { email, password, username } = request.body;
      const result = await accounts.create({
        email,
        passwordHash: await hashPassword(password),
        username,
      });

      if ("duplicates" in result) {
        return reply.code(409).send({
          message: "An account with these details already exists.",
          fieldErrors: Object.fromEntries(
            result.duplicates.map((field) => [field, duplicateMessages[field]]),
          ),
        });
      }

      await startSession(reply, result.account.id);
      return reply.code(201).send({ account: result.account });
    },
  );

  app.post(
    accountContracts.login.path,
    {
      schema: {
        body: accountContracts.login.body,
        response: {
          200: accountContracts.login.response,
          400: accountContracts.login.errors[400],
          401: accountContracts.login.errors[401],
        },
      },
    },
    async (request, reply) => {
      const credentials = await accounts.findCredentials(
        request.body.identifier,
      );
      const passwordMatches = await verifyPassword(
        request.body.password,
        credentials?.passwordHash ?? (await unmatchedPasswordHash),
      );

      if (!credentials || !passwordMatches) {
        return reply.code(401).send({
          message: "Incorrect username, email, or password.",
        });
      }

      await startSession(reply, credentials.account.id);
      return { account: credentials.account };
    },
  );

  app.post(
    accountContracts.logout.path,
    { schema: { response: { 200: accountContracts.logout.response } } },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await accounts.deleteSession(token);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { status: "ok" as const };
    },
  );

  app.get(
    accountContracts.session.path,
    { schema: { response: { 200: accountContracts.session.response } } },
    async (request) => ({ account: (await currentAccount(request)) ?? null }),
  );

  app.get(
    accountContracts.account.path,
    {
      schema: {
        response: {
          200: accountContracts.account.response,
          401: accountContracts.account.errors[401],
        },
      },
    },
    async (request, reply) => {
      const account = await currentAccount(request);
      if (!account) {
        return reply.code(401).send({ message: "Log in to continue." });
      }
      return { account };
    },
  );

  app.patch(
    accountContracts.updateAccount.path,
    {
      schema: {
        body: accountContracts.updateAccount.body,
        response: {
          200: accountContracts.updateAccount.response,
          400: accountContracts.updateAccount.errors[400],
          401: accountContracts.updateAccount.errors[401],
          409: accountContracts.updateAccount.errors[409],
        },
      },
    },
    async (request, reply) => {
      const account = await currentAccount(request);
      if (!account) {
        return reply.code(401).send({ message: "Log in to continue." });
      }

      const result = await accounts.update(account.id, request.body);
      if (!result) {
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.code(401).send({ message: "Log in to continue." });
      }
      if ("duplicates" in result) {
        return reply.code(409).send({
          message: "An account with these details already exists.",
          fieldErrors: Object.fromEntries(
            result.duplicates.map((field) => [field, duplicateMessages[field]]),
          ),
        });
      }
      return result;
    },
  );

  app.delete(
    accountContracts.deleteAccount.path,
    {
      schema: {
        response: {
          200: accountContracts.deleteAccount.response,
          401: accountContracts.deleteAccount.errors[401],
        },
      },
    },
    async (request, reply) => {
      const account = await currentAccount(request);
      if (!account) {
        return reply.code(401).send({ message: "Log in to continue." });
      }

      await accounts.delete(account.id);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { status: "ok" as const };
    },
  );
};
