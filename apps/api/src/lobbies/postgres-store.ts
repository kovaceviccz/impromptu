import { MikroORM } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";

import { PrivateLobbyEntity, PrivateLobbySchema } from "./entity.js";
import { Migration20260930000000 } from "./migrations/Migration20260930000000.js";
import type { PrivateLobbyRecord, PrivateLobbyStore } from "./store.js";

export async function createPostgresPrivateLobbyStore(databaseUrl: string) {
  const orm = await MikroORM.init({
    clientUrl: databaseUrl,
    driverOptions: { ssl: false },
    entities: [PrivateLobbySchema],
    extensions: [Migrator],
    migrations: {
      migrationsList: [Migration20260930000000],
      snapshotOnMigrate: false,
      transactional: true,
    },
  });

  const store: PrivateLobbyStore = {
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
    async delete(id) {
      const em = orm.em.fork();
      await em.nativeDelete(PrivateLobbyEntity, { id });
    },
    async close() {
      await orm.close(true);
    },
  };

  return { orm, store };
}

export async function migratePrivateLobbies(databaseUrl: string) {
  const { orm } = await createPostgresPrivateLobbyStore(databaseUrl);
  try {
    await orm.migrator.up();
  } finally {
    await orm.close(true);
  }
}

function toRecord(entity: PrivateLobbyEntity): PrivateLobbyRecord {
  return {
    id: entity.id,
    topicId: entity.topicId,
    codeHash: entity.codeHash,
    creatorIdentity: entity.creatorIdentity,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
  };
}
