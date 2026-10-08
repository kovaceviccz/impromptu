import { fileURLToPath } from "node:url";

import { Migrator } from "@mikro-orm/migrations";
import { MikroORM } from "@mikro-orm/postgresql";

import { AccountSchema, AccountSessionSchema } from "./accounts/entity.js";
import { PrivateLobbySchema } from "./lobbies/entity.js";
import { PublicLobbyStateSchema } from "./lobbies/public-state-entity.js";

/** Opens the PostgreSQL connection shared by every persistent feature. */
export async function openDatabase(databaseUrl: string) {
  const connectionUrl = new URL(databaseUrl);
  const sslMode = connectionUrl.searchParams.get("sslmode");
  return MikroORM.init({
    clientUrl: databaseUrl,
    driverOptions: {
      ssl:
        sslMode === "require" ||
        sslMode === "verify-ca" ||
        sslMode === "verify-full"
          ? { rejectUnauthorized: true }
          : false,
      enableChannelBinding:
        connectionUrl.searchParams.get("channel_binding") === "require",
    },
    entities: [
      AccountSchema,
      AccountSessionSchema,
      PrivateLobbySchema,
      PublicLobbyStateSchema,
    ],
    extensions: [Migrator],
    migrations: {
      path: fileURLToPath(new URL("./migrations", import.meta.url)),
      snapshotOnMigrate: false,
      transactional: true,
    },
  });
}

export async function migrateDatabase(databaseUrl: string) {
  const orm = await openDatabase(databaseUrl);
  try {
    await orm.migrator.up();
  } finally {
    await orm.close(true);
  }
}
