import type { MikroORM } from "@mikro-orm/postgresql";

import { PrivateLobbyEntity } from "./entity.js";
import type { PrivateLobbyRecord, PrivateLobbyStore } from "./store.js";

export function createPostgresPrivateLobbyStore(
  orm: MikroORM,
): PrivateLobbyStore {
  return {
    async create(lobby) {
      const em = orm.em.fork();
      em.create(PrivateLobbyEntity, {
        ...lobby,
        name: lobby.name ?? lobby.topicId,
        side0: lobby.side0 ?? null,
        side1: lobby.side1 ?? null,
        visibility: lobby.visibility ?? "private",
      });
      await em.flush();
    },
    async findByCodeHash(codeHash) {
      const entity = await orm.em.fork().findOne(PrivateLobbyEntity, {
        codeHash,
      });
      return entity ? toRecord(entity) : undefined;
    },
    async listPublic() {
      const entities = await orm.em
        .fork()
        .find(
          PrivateLobbyEntity,
          { visibility: "public", state: { $ne: "ENDED" } },
          { orderBy: { createdAt: "DESC" } },
        );
      return entities.map(toRecord);
    },
    async hasCreatedName(name) {
      const rows: unknown[] = await orm.em
        .fork()
        .getConnection()
        .execute(
          `select 1 from "private_lobby" where "topic_id" = "id"::text and lower("name") = lower(?) limit 1`,
          [name],
        );
      return rows.length > 0;
    },
    async findById(id) {
      const entity = await orm.em.fork().findOne(PrivateLobbyEntity, { id });
      return entity ? toRecord(entity) : undefined;
    },
    async updateState(id, expectedState, state, roundEndsAt, voting) {
      const updated = await orm.em.fork().nativeUpdate(
        PrivateLobbyEntity,
        { id, state: expectedState },
        {
          state,
          ...(roundEndsAt !== undefined ? { roundEndsAt } : {}),
          ...(voting ? { voting } : {}),
        },
      );
      return updated > 0;
    },
    async delete(id) {
      const em = orm.em.fork();
      await em.nativeDelete(PrivateLobbyEntity, { id });
    },
    // The shared connection is closed by the process that opened it.
    async dueRounds(now) {
      return (
        await orm.em.fork().find(PrivateLobbyEntity, {
          state: "DEBATE_IN_PROGRESS",
          roundEndsAt: { $lte: now },
        })
      ).map(toRecord);
    },
    async dueVotes(now) {
      return (await orm.em.fork().find(PrivateLobbyEntity, { state: "VOTING" }))
        .map(toRecord)
        .filter(
          (lobby) =>
            lobby.voting && Date.parse(lobby.voting.endsAt) <= now.getTime(),
        );
    },
    async submitVote(id, identity, choice) {
      const rows: unknown[] = await orm.em
        .fork()
        .getConnection()
        .execute(
          `update "private_lobby" set voting = jsonb_set(voting, '{votes}', (voting->'votes') || jsonb_build_object(?::text, ?::text))
         where "id" = ? and state = 'VOTING' and (voting->>'endsAt')::timestamptz > clock_timestamp()
         and jsonb_exists(voting->'eligible', ?::text) returning "id"`,
          [identity, choice, id, identity],
        );
      return rows.length > 0;
    },
    async close() {},
  };
}

function toRecord(entity: PrivateLobbyEntity): PrivateLobbyRecord {
  return {
    id: entity.id,
    topicId: entity.topicId,
    name: entity.name,
    side0: entity.side0,
    side1: entity.side1,
    visibility: entity.visibility,
    state: entity.state,
    roundEndsAt: entity.roundEndsAt,
    voting: entity.voting,
    codeHash: entity.codeHash,
    creatorIdentity: entity.creatorIdentity,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
  };
}
