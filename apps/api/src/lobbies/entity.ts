import { EntitySchema } from "@mikro-orm/core";

import type { LobbyState } from "./contract.js";

export class PrivateLobbyEntity {
  id!: string;
  topicId!: string;
  state!: LobbyState;
  codeHash!: string;
  creatorIdentity!: string;
  createdAt!: Date;
  expiresAt!: Date | null;
}

export const PrivateLobbySchema = new EntitySchema<PrivateLobbyEntity>({
  class: PrivateLobbyEntity,
  tableName: "private_lobby",
  indexes: [
    {
      name: "private_lobby_expires_at_idx",
      properties: ["expiresAt"],
      where: "expires_at is not null",
    },
  ],
  properties: {
    id: { type: "uuid", primary: true },
    topicId: { type: "string", fieldName: "topic_id", columnType: "text" },
    state: {
      type: "string",
      columnType: "text",
      defaultRaw: "'WAITING'",
    },
    codeHash: {
      type: "string",
      fieldName: "code_hash",
      columnType: "char(64)",
      unique: "private_lobby_code_hash_key",
    },
    creatorIdentity: { type: "uuid", fieldName: "creator_identity" },
    createdAt: {
      type: Date,
      fieldName: "created_at",
      defaultRaw: "now()",
    },
    expiresAt: {
      type: Date,
      fieldName: "expires_at",
      nullable: true,
    },
  },
});
