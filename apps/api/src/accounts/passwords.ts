import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const COST = { N: 16_384, r: 8, p: 1 } as const;

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, cost, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Produces a self-describing `scrypt$N$r$p$salt$hash` string. */
export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST);
  return [
    ALGORITHM,
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, n, r, p, salt, hash] = stored.split("$");
  if (algorithm !== ALGORITHM || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64");
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (
    expected.length !== KEY_LENGTH ||
    !Object.values(cost).every(Number.isSafeInteger)
  ) {
    return false;
  }

  const actual = await derive(password, Buffer.from(salt, "base64"), cost);
  return timingSafeEqual(actual, expected);
}
