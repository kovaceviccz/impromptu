import { z } from "zod";

const configSchema = z.object({
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAILPIT_URL: z.url().default("http://127.0.0.1:8025"),
  PUBLIC_ORIGIN: z.url().default("http://localhost:5173"),
  MAILBOX_ACCOUNT_IDS: z.string().default(""),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  DEV_DATABASE_RESET: z.enum(["true", "false"]).default("false"),
  LIVEKIT_API_URL: z.url().default("http://127.0.0.1:7880"),
  LIVEKIT_PUBLIC_URL: z.string().min(1).default("ws://127.0.0.1:7880"),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(16),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(15)
    .max(86_400)
    .default(86_400),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(environment);
}

export type Config = z.output<typeof configSchema>;
