import { z } from "zod";

export const healthSchema = z.strictObject({ status: z.literal("ok") });

export const healthContract = {
  method: "GET",
  path: "/api/health",
  response: healthSchema,
} as const;
