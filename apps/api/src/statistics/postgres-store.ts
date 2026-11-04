import { randomUUID } from "node:crypto";

import type { MikroORM } from "@mikro-orm/postgresql";

import { calculateStatistics, type DebateResultStore } from "./store.js";

export function createPostgresDebateResultStore(
  orm: MikroORM,
): DebateResultStore {
  return {
    async recordResults(lobbyId, participants, winningSide) {
      const connection = orm.em.fork().getConnection();
      for (const participant of participants) {
        const outcome =
          winningSide === null
            ? "draw"
            : participant.sideIndex === winningSide
              ? "win"
              : "loss";
        await connection.execute(
          `insert into "debate_result" ("id", "lobby_id", "account_id", "outcome")
           select ?, ?, "id", ? from "account" where "id" = ?
           on conflict ("lobby_id", "account_id") do nothing`,
          [randomUUID(), lobbyId, outcome, participant.accountId],
        );
      }
    },
    async statisticsFor(accountId) {
      const rows: { outcome: "win" | "loss" | "draw" }[] = await orm.em
        .fork()
        .getConnection()
        .execute(
          `select "outcome" from "debate_result" where "account_id" = ?`,
          [accountId],
        );
      return calculateStatistics(rows.map(({ outcome }) => outcome));
    },
  };
}
