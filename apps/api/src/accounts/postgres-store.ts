import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";

import type { Account } from "./contract.js";
import { AccountEntity, AccountSessionEntity } from "./entity.js";
import {
  type AccountStore,
  type DuplicateField,
  hashSessionToken,
  issueSessionToken,
  newAccount,
} from "./store.js";

function toAccount(entity: AccountEntity): Account {
  return {
    id: entity.id,
    displayName: entity.displayName,
    username: entity.username,
    email: entity.email,
    createdAt: entity.createdAt.toISOString(),
  };
}

async function duplicateFields(
  em: EntityManager,
  username: string,
  email: string,
  excludedAccountId?: string,
) {
  const usernameKey = username.toLowerCase();
  const existing = await em.find(AccountEntity, {
    $or: [{ usernameKey }, { email }],
  });
  const fields = new Set<DuplicateField>();
  for (const account of existing) {
    if (account.id === excludedAccountId) continue;
    if (account.usernameKey === usernameKey) fields.add("username");
    if (account.email === email) fields.add("email");
  }
  return [...fields];
}

export function createPostgresAccountStore(orm: MikroORM): AccountStore {
  return {
    async create(input) {
      const em = orm.em.fork();
      const duplicates = await duplicateFields(em, input.username, input.email);
      if (duplicates.length > 0) return { duplicates };

      const { account, usernameKey } = newAccount(input);
      em.create(AccountEntity, {
        id: account.id,
        displayName: account.displayName,
        username: account.username,
        usernameKey,
        email: account.email,
        passwordHash: input.passwordHash,
        createdAt: new Date(account.createdAt),
      });
      try {
        await em.flush();
      } catch (error) {
        // Another registration claimed the username or email first.
        if (!(error instanceof UniqueConstraintViolationException)) throw error;
        return {
          duplicates: await duplicateFields(
            orm.em.fork(),
            input.username,
            input.email,
          ),
        };
      }
      return { account };
    },

    async findCredentials(identifier) {
      const key = identifier.toLowerCase();
      const entity = await orm.em.fork().findOne(AccountEntity, {
        $or: [{ usernameKey: key }, { email: key }],
      });
      return entity
        ? { account: toAccount(entity), passwordHash: entity.passwordHash }
        : undefined;
    },

    async update(accountId, input) {
      const em = orm.em.fork();
      const entity = await em.findOne(AccountEntity, { id: accountId });
      if (!entity) return undefined;

      const duplicates = await duplicateFields(
        em,
        input.username,
        input.email,
        accountId,
      );
      if (duplicates.length > 0) return { duplicates };

      entity.username = input.username;
      entity.displayName = input.displayName;
      entity.usernameKey = input.username.toLowerCase();
      entity.email = input.email;
      try {
        await em.flush();
      } catch (error) {
        if (!(error instanceof UniqueConstraintViolationException)) throw error;
        return {
          duplicates: await duplicateFields(
            orm.em.fork(),
            input.username,
            input.email,
            accountId,
          ),
        };
      }
      return { account: toAccount(entity) };
    },

    async delete(accountId) {
      return (
        (await orm.em.fork().nativeDelete(AccountEntity, { id: accountId })) > 0
      );
    },

    async createSession(accountId) {
      const em = orm.em.fork();
      const { token, tokenHash, expiresAt } = issueSessionToken();
      await em.nativeDelete(AccountSessionEntity, {
        expiresAt: { $lte: new Date() },
      });
      em.create(AccountSessionEntity, {
        tokenHash,
        account: em.getReference(AccountEntity, accountId),
        expiresAt,
      });
      await em.flush();
      return { token, expiresAt };
    },

    async findSessionAccount(token) {
      const session = await orm.em.fork().findOne(
        AccountSessionEntity,
        {
          tokenHash: hashSessionToken(token),
          expiresAt: { $gt: new Date() },
        },
        { populate: ["account"] },
      );
      return session ? toAccount(session.account) : undefined;
    },

    async deleteSession(token) {
      await orm.em.fork().nativeDelete(AccountSessionEntity, {
        tokenHash: hashSessionToken(token),
      });
    },
  };
}
