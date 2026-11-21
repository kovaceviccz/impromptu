import { smtpDelivery } from "./mail/delivery.js";
import { seedDemoTopics } from "./topics/seed-demo.js";
import { createPostgresAccountStore } from "./accounts/postgres-store.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { createPostgresPrivateLobbyStore } from "./lobbies/postgres-store.js";
import { createPostgresPublicLobbyStateStore } from "./lobbies/public-state-postgres-store.js";
import { createLiveKitGateway } from "./topics/livekit.js";
import { createPostgresDebateResultStore } from "./statistics/postgres-store.js";

const config = loadConfig();
const production = process.env.NODE_ENV === "production";
const orm = await openDatabase(config.DATABASE_URL);
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
if (config.DEV_DATABASE_RESET === "true")
  await seedDemoTopics(config.DATABASE_URL, "DEBATE26");
const app = await buildApp({
  invitationSecret: config.LIVEKIT_API_SECRET,
  mail: smtpDelivery(config.SMTP_HOST, config.SMTP_PORT),
  publicOrigin: config.PUBLIC_ORIGIN,
  mailpitUrl: config.MAILPIT_URL,
  mailboxAccountIds: config.MAILBOX_ACCOUNT_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  checkDatabase: async () => {
    const pool = await orm.em.getConnection().getNativeClient();
    await pool.query({ text: "select 1", query_timeout: 2000 });
  },
  accounts: createPostgresAccountStore(orm),
  debateResults: createPostgresDebateResultStore(orm),
  privateLobbies: createPostgresPrivateLobbyStore(orm),
  publicLobbyState: createPostgresPublicLobbyStateStore(orm),
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
  await orm.close(true);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
