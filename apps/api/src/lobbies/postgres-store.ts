import type { MikroORM } from "@mikro-orm/postgresql";

import { PrivateLobbyEntity } from "./entity.js";
import type { PrivateLobbyRecord, PrivateLobbyStore } from "./store.js";

export function createPostgresPrivateLobbyStore(
  orm: MikroORM,
): PrivateLobbyStore {
  return {
    async create(lobby) {
      const em = orm.em.fork();
      em.create(PrivateLobbyEntity, lobby);
      await em.flush();
    },
    async findByCodeHash(codeHash) {
      const entity = await orm.em.fork().findOne(PrivateLobbyEntity, {
        codeHash,
      });
      return entity ? toRecord(entity) : undefined;
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
    state: entity.state,
    codeHash: entity.codeHash,
    creatorIdentity: entity.creatorIdentity,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
  };
}
