import { EntitySchema } from "@mikro-orm/core";

export class PrivateLobbyEntity {
  id!: string;
  topicId!: string;
  codeHash!: string;
  creatorIdentity!: string;
  createdAt!: Date;
  expiresAt!: Date | null;
}

export const PrivateLobbySchema = new EntitySchema<PrivateLobbyEntity>({
  class: PrivateLobbyEntity,
  tableName: "private_lobby",
  properties: {
    id: { type: "uuid", primary: true },
    topicId: { type: "string", fieldName: "topic_id" },
    codeHash: {
      type: "string",
      fieldName: "code_hash",
      length: 64,
      unique: true,
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
