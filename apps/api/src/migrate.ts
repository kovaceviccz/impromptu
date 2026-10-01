import { migratePrivateLobbies } from "./lobbies/postgres-store.js";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required to run migrations");
}

await migratePrivateLobbies(databaseUrl);
