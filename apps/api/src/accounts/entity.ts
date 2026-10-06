import { EntitySchema } from "@mikro-orm/core";

export class AccountEntity {
  id!: string;
  username!: string;
  // Lower-cased username, so uniqueness ignores case without an expression index.
  usernameKey!: string;
  email!: string;
  passwordHash!: string;
  createdAt!: Date;
}

export const AccountSchema = new EntitySchema<AccountEntity>({
  class: AccountEntity,
  tableName: "account",
  properties: {
    id: { type: "uuid", primary: true },
    username: { type: "string", columnType: "text" },
    usernameKey: {
      type: "string",
      fieldName: "username_key",
      columnType: "text",
      unique: "account_username_key_key",
    },
    email: {
      type: "string",
      columnType: "text",
      unique: "account_email_key",
    },
    passwordHash: {
      type: "string",
      fieldName: "password_hash",
      columnType: "text",
    },
    createdAt: {
      type: Date,
      fieldName: "created_at",
      defaultRaw: "now()",
    },
  },
});

export class AccountSessionEntity {
  tokenHash!: string;
  account!: AccountEntity;
  expiresAt!: Date;
}

export const AccountSessionSchema = new EntitySchema<AccountSessionEntity>({
  class: AccountSessionEntity,
  tableName: "account_session",
  indexes: [
    {
      name: "account_session_expires_at_idx",
      properties: ["expiresAt"],
    },
  ],
  properties: {
    tokenHash: {
      type: "string",
      primary: true,
      fieldName: "token_hash",
      columnType: "char(64)",
    },
    account: {
      kind: "m:1",
      entity: () => AccountEntity,
      fieldName: "account_id",
      deleteRule: "cascade",
    },
    expiresAt: { type: Date, fieldName: "expires_at" },
  },
});
