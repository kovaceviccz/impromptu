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
    async updateState(id, expectedState, state) {
      const updated = await orm.em
        .fork()
        .nativeUpdate(
          PrivateLobbyEntity,
          { id, state: expectedState },
          { state },
        );
      return updated > 0;
    },
    async delete(id) {
      const em = orm.em.fork();
      await em.nativeDelete(PrivateLobbyEntity, { id });
    },
    // The shared connection is closed by the process that opened it.
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
    codeHash: entity.codeHash,
    creatorIdentity: entity.creatorIdentity,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
  };
}
