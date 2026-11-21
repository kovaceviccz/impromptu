import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod";
import { expect, it, vi } from "vitest";
import { healthRoutes } from "./routes.js";

it("reports database failure without exposing connection details and recovers", async () => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const checkDatabase = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  await app.register(healthRoutes, { checkDatabase });
  try {
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    checkDatabase.mockRejectedValueOnce(
      new Error("private database credential"),
    );
    const failed = await app.inject("/api/health");
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: "unavailable" });
    expect((await app.inject("/api/health")).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
