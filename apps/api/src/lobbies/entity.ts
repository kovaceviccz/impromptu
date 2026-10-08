import { EntitySchema } from "@mikro-orm/core";

import type { LobbyState } from "./contract.js";

export class PrivateLobbyEntity {
  id!: string;
  topicId!: string;
  name!: string;
  side0!: string | null;
  side1!: string | null;
  visibility!: "public" | "private";
  state!: LobbyState;
  codeHash!: string | null;
  creatorIdentity!: string;
  createdAt!: Date;
  expiresAt!: Date | null;
}

export const PrivateLobbySchema = new EntitySchema<PrivateLobbyEntity>({
  class: PrivateLobbyEntity,
  tableName: "private_lobby",
  checks: [
    {
      name: "private_lobby_state_check",
      expression:
        "state in ('WAITING', 'DEBATE_IN_PROGRESS', 'VOTING', 'ENDED')",
    },
    {
      name: "private_lobby_visibility_check",
      expression: "visibility in ('public', 'private')",
    },
    {
      name: "private_lobby_code_visibility_check",
      expression:
        "(visibility = 'private' and code_hash is not null) or (visibility = 'public' and code_hash is null)",
    },
  ],
  indexes: [
    {
      name: "private_lobby_expires_at_idx",
      properties: ["expiresAt"],
      where: "expires_at is not null",
    },
  ],
  uniques: [
    {
      name: "private_lobby_created_topic_name_key",
      expression:
        'create unique index "private_lobby_created_topic_name_key" on "private_lobby" (lower("name")) where "topic_id" = "id"::text',
    },
  ],
  properties: {
    id: { type: "uuid", primary: true },
    topicId: { type: "string", fieldName: "topic_id", columnType: "text" },
    name: { type: "string", columnType: "text" },
    side0: {
      type: "string",
      fieldName: "side_0",
      columnType: "text",
      nullable: true,
    },
    side1: {
      type: "string",
      fieldName: "side_1",
      columnType: "text",
      nullable: true,
    },
    visibility: { type: "string", columnType: "text", defaultRaw: "'private'" },
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
      nullable: true,
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
