import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./passwords.js";

describe("password hashing", () => {
  it("salts each hash and verifies only the original password", async () => {
    const first = await hashPassword("correct horse battery");
    const second = await hashPassword("correct horse battery");

    expect(first).not.toBe(second);
    expect(first).not.toContain("correct horse battery");
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    await expect(verifyPassword("correct horse battery", first)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("correct horse", first)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("password", "plain-text")).resolves.toBe(false);
    await expect(
      verifyPassword("password", "scrypt$x$8$1$c2FsdA==$aGFzaA=="),
    ).resolves.toBe(false);
  });
});
