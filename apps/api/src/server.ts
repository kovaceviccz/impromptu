import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLiveKitGateway } from "./topics/livekit.js";

const config = loadConfig();
const app = await buildApp({
  livekit: createLiveKitGateway({
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
    apiUrl: config.LIVEKIT_API_URL,
    tokenTtlSeconds: config.LIVEKIT_TOKEN_TTL_SECONDS,
  }),
  livekitPublicUrl: config.LIVEKIT_PUBLIC_URL,
  tokenTtlSeconds: config.LIVEKIT_TOKEN_TTL_SECONDS,
  logger: true,
  serveWeb: process.env.NODE_ENV === "production",
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
