import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPostgresPrivateLobbyStore } from "./lobbies/postgres-store.js";
import { openDatabase } from "./database.js";
import { createLiveKitGateway } from "./topics/livekit.js";

const config = loadConfig();
const production = process.env.NODE_ENV === "production";
const database = openDatabase(config.DATABASE_PATH);
const { orm, store: privateLobbies } = await createPostgresPrivateLobbyStore(
  config.DATABASE_URL,
);
if (config.DEV_DATABASE_RESET === "true") {
  if (
    process.env.NODE_ENV !== "development" ||
    new URL(config.DATABASE_URL).hostname !== "postgres"
  ) {
    throw new Error(
      "Development database reset requires local Compose PostgreSQL",
    );
  }
  await orm.schema.drop({ dropMigrationsTable: true });
  await orm.migrator.up();
}
const app = await buildApp({
  database,
  privateLobbies,
  livekit: createLiveKitGateway({
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
    apiUrl: config.LIVEKIT_API_URL,
    tokenTtlSeconds: config.LIVEKIT_TOKEN_TTL_SECONDS,
  }),
  livekitPublicUrl: config.LIVEKIT_PUBLIC_URL,
  tokenTtlSeconds: config.LIVEKIT_TOKEN_TTL_SECONDS,
  logger: true,
  secureCookies: production,
  serveWeb: production,
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  database.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
