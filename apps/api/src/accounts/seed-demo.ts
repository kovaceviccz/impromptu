import type { MikroORM } from "@mikro-orm/postgresql";
import { hashPassword } from "./passwords.js";

export const DEMO_HOST_ID = "d3000000-0000-4000-8000-000000000001";
export const DEMO_PASSWORD = "DemoOnly2026!";
export async function seedDemoAccounts(orm: MikroORM) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [id, username] of [
    [DEMO_HOST_ID, "demo_host"],
    ["d3000000-0000-4000-8000-000000000002", "demo_guest"],
  ]) {
    await orm.em
      .fork()
      .getConnection()
      .execute(
        `insert into account (id, display_name, username, username_key, email, password_hash, created_at) values (?, ?, ?, ?, ?, ?, now()) on conflict do nothing`,
        [
          id,
          username,
          username,
          username,
          `${username}@example.test`,
          passwordHash,
        ],
      );
  }
}
