import { EntitySchema } from "@mikro-orm/core";

import { AccountEntity } from "../accounts/entity.js";
import type { DebateOutcome } from "./store.js";

export class DebateResultEntity {
  id!: string;
  lobbyId!: string;
  account!: AccountEntity;
  outcome!: DebateOutcome;
  createdAt!: Date;
}

export const DebateResultSchema = new EntitySchema<DebateResultEntity>({
  class: DebateResultEntity,
  tableName: "debate_result",
  checks: [
    {
      name: "debate_result_outcome_check",
      expression: "outcome in ('win', 'loss', 'draw')",
    },
  ],
  indexes: [
    {
      name: "debate_result_account_id_idx",
      properties: ["account"],
    },
  ],
  uniques: [
    {
      name: "debate_result_lobby_account_key",
      properties: ["lobbyId", "account"],
    },
  ],
  properties: {
    id: { type: "uuid", primary: true },
    lobbyId: {
      type: "string",
      fieldName: "lobby_id",
      columnType: "text",
    },
    account: {
      kind: "m:1",
      entity: () => AccountEntity,
      fieldName: "account_id",
      deleteRule: "cascade",
    },
    outcome: { type: "string", columnType: "text" },
    createdAt: {
      type: Date,
      fieldName: "created_at",
      defaultRaw: "now()",
    },
  },
});
