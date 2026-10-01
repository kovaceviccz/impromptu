import { migrateDatabase } from "./database.js";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required to run migrations");
}

await migrateDatabase(databaseUrl);
