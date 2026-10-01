import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  DEV_DATABASE_RESET: z.enum(["true", "false"]).default("false"),
  DATABASE_PATH: z.string().min(1).default("impromptu.db"),
  LIVEKIT_API_URL: z.url().default("http://127.0.0.1:7880"),
  LIVEKIT_PUBLIC_URL: z.string().min(1).default("ws://127.0.0.1:7880"),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(16),
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(15)
    .max(300)
    .default(60),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(environment);
}

export type Config = z.output<typeof configSchema>;
