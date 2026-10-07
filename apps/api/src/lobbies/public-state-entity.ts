import { EntitySchema } from "@mikro-orm/core";

import type { LobbyState } from "./contract.js";

export class PublicLobbyStateEntity {
  topicId!: string;
  hostIdentity!: string | null;
  state!: LobbyState;
}

export const PublicLobbyStateSchema = new EntitySchema<PublicLobbyStateEntity>({
  class: PublicLobbyStateEntity,
  tableName: "public_lobby_state",
  checks: [
    {
      name: "public_lobby_state_state_check",
      expression:
        "state in ('WAITING', 'DEBATE_IN_PROGRESS', 'VOTING', 'ENDED')",
    },
  ],
  properties: {
    topicId: {
      type: "string",
      fieldName: "topic_id",
      columnType: "text",
      primary: true,
    },
    hostIdentity: {
      type: "uuid",
      fieldName: "host_identity",
      nullable: true,
    },
    state: {
      type: "string",
      columnType: "text",
      defaultRaw: "'WAITING'",
    },
  },
});
