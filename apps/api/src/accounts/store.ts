import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Account } from "./contract.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type DuplicateField = "email" | "username";

export type NewAccount = {
  username: string;
  email: string;
  passwordHash: string;
};

export interface AccountStore {
  /** Returns the duplicated fields instead of an account when either is taken. */
  create(
    input: NewAccount,
  ): Promise<{ account: Account } | { duplicates: DuplicateField[] }>;
  /** Finds an account by username or email, ignoring case. */
  findCredentials(
    identifier: string,
  ): Promise<{ account: Account; passwordHash: string } | undefined>;
  update(
    accountId: string,
    input: { username: string; email: string },
  ): Promise<
    { account: Account } | { duplicates: DuplicateField[] } | undefined
  >;
  delete(accountId: string): Promise<boolean>;
  createSession(accountId: string): Promise<{ token: string; expiresAt: Date }>;
  findSessionAccount(token: string): Promise<Account | undefined>;
  deleteSession(token: string): Promise<void>;
}

/** Only a digest of each session token is stored. */
export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
}

export function newAccount(input: NewAccount) {
  return {
    account: {
      id: randomUUID(),
      username: input.username,
      email: input.email,
      createdAt: new Date().toISOString(),
    } satisfies Account,
    usernameKey: input.username.toLowerCase(),
  };
}

export function createMemoryAccountStore(): AccountStore {
  const accounts = new Map<
    string,
    { account: Account; usernameKey: string; passwordHash: string }
  >();
  const sessions = new Map<string, { accountId: string; expiresAt: Date }>();

  function duplicateFields(username: string, email: string) {
    const usernameKey = username.toLowerCase();
    const fields = new Set<DuplicateField>();
    for (const stored of accounts.values()) {
      if (stored.usernameKey === usernameKey) fields.add("username");
      if (stored.account.email === email) fields.add("email");
    }
    return [...fields];
  }

  return {
    async create(input) {
      const duplicates = duplicateFields(input.username, input.email);
      if (duplicates.length > 0) return { duplicates };

      const { account, usernameKey } = newAccount(input);
      accounts.set(account.id, {
        account,
        usernameKey,
        passwordHash: input.passwordHash,
      });
      return { account };
    },
    async findCredentials(identifier) {
      const key = identifier.toLowerCase();
      for (const stored of accounts.values()) {
        if (stored.usernameKey === key || stored.account.email === key) {
          return {
            account: stored.account,
            passwordHash: stored.passwordHash,
          };
        }
      }
      return undefined;
    },
    async update(accountId, input) {
      const stored = accounts.get(accountId);
      if (!stored) return undefined;

      const usernameKey = input.username.toLowerCase();
      const fields = new Set<DuplicateField>();
      for (const [id, candidate] of accounts) {
        if (id === accountId) continue;
        if (candidate.usernameKey === usernameKey) fields.add("username");
        if (candidate.account.email === input.email) fields.add("email");
      }
      if (fields.size > 0) return { duplicates: [...fields] };

      const account = {
        ...stored.account,
        username: input.username,
        email: input.email,
      };
      accounts.set(accountId, { ...stored, account, usernameKey });
      return { account };
    },
    async delete(accountId) {
      const deleted = accounts.delete(accountId);
      if (!deleted) return false;
      for (const [tokenHash, session] of sessions) {
        if (session.accountId === accountId) sessions.delete(tokenHash);
      }
      return true;
    },
    async createSession(accountId) {
      const { token, tokenHash, expiresAt } = issueSessionToken();
      sessions.set(tokenHash, { accountId, expiresAt });
      return { token, expiresAt };
    },
    async findSessionAccount(token) {
      const session = sessions.get(hashSessionToken(token));
      if (!session || session.expiresAt <= new Date()) return undefined;
      return accounts.get(session.accountId)?.account;
    },
    async deleteSession(token) {
      sessions.delete(hashSessionToken(token));
    },
  };
}
