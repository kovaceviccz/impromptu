import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type { Account } from "./contract.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

type DuplicateField = "email" | "username";

const accountRowSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  created_at: z.string(),
});

const credentialRowSchema = accountRowSchema.extend({
  password_hash: z.string(),
});

function toAccount(row: z.output<typeof accountRowSchema>): Account {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
  };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { errcode?: unknown }).errcode === SQLITE_CONSTRAINT_UNIQUE
  );
}

export function migrateAccounts(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_account_id ON sessions (account_id);
  `);
}

export function createAccountStore(database: DatabaseSync) {
  migrateAccounts(database);

  const statements = {
    duplicates: database.prepare(
      "SELECT username = :username AS username, email = :email AS email FROM accounts WHERE username = :username OR email = :email",
    ),
    insertAccount: database.prepare(
      "INSERT INTO accounts (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ),
    findCredentials: database.prepare(
      "SELECT id, username, email, created_at, password_hash FROM accounts WHERE username = :identifier OR email = :identifier",
    ),
    deleteExpiredSessions: database.prepare(
      "DELETE FROM sessions WHERE expires_at <= ?",
    ),
    insertSession: database.prepare(
      "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
    ),
    findSession: database.prepare(
      "SELECT accounts.id, accounts.username, accounts.email, accounts.created_at FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
    ),
    deleteSession: database.prepare(
      "DELETE FROM sessions WHERE token_hash = ?",
    ),
  };

  function duplicateFields(username: string, email: string) {
    const fields = new Set<DuplicateField>();
    for (const row of statements.duplicates.all({ username, email })) {
      if (row.username === 1) fields.add("username");
      if (row.email === 1) fields.add("email");
    }
    return [...fields];
  }

  return {
    duplicateFields,

    /** Returns the duplicated fields instead of an account when either is taken. */
    create(input: {
      username: string;
      email: string;
      passwordHash: string;
    }): { account: Account } | { duplicates: DuplicateField[] } {
      const duplicates = duplicateFields(input.username, input.email);
      if (duplicates.length > 0) return { duplicates };

      const account: Account = {
        id: randomUUID(),
        username: input.username,
        email: input.email,
        createdAt: new Date().toISOString(),
      };
      try {
        statements.insertAccount.run(
          account.id,
          account.username,
          account.email,
          input.passwordHash,
          account.createdAt,
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return { duplicates: duplicateFields(input.username, input.email) };
      }
      return { account };
    },

    findCredentials(identifier: string) {
      const row = statements.findCredentials.get({ identifier });
      if (row === undefined) return undefined;
      const credentials = credentialRowSchema.parse(row);
      return {
        account: toAccount(credentials),
        passwordHash: credentials.password_hash,
      };
    },

    createSession(accountId: string) {
      const now = Date.now();
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now + SESSION_TTL_MS);
      statements.deleteExpiredSessions.run(now);
      statements.insertSession.run(
        hashToken(token),
        accountId,
        expiresAt.getTime(),
      );
      return { token, expiresAt };
    },

    findSessionAccount(token: string) {
      const row = statements.findSession.get(hashToken(token), Date.now());
      return row === undefined
        ? undefined
        : toAccount(accountRowSchema.parse(row));
    },

    deleteSession(token: string) {
      statements.deleteSession.run(hashToken(token));
    },
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
