import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { openDatabase } from "../database.js";
import { hashLobbyCode } from "../lobbies/codes.js";
import { createPostgresPrivateLobbyStore } from "../lobbies/postgres-store.js";
import type { PrivateLobbyRecord } from "../lobbies/store.js";

const publicId = "b9f857ae-9aa5-43d8-a285-75f2c8ff3c17";
const privateId = "611d53c8-b130-4cf4-bb73-3b3375101224";

export async function seedDemoTopics(databaseUrl: string, privateCode: string) {
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(privateCode)) {
    throw new Error("DEMO_PRIVATE_CODE must be eight unambiguous characters.");
  }
  const orm = await openDatabase(databaseUrl);
  try {
    const store = createPostgresPrivateLobbyStore(orm);
    const topics: (PrivateLobbyRecord & { name: string })[] = [
      {
        id: publicId,
        topicId: publicId,
        name: "Demo: Should AI judge debates?",
        side0: "Yes: it can apply rules consistently",
        side1: "No: human judgment is essential",
        visibility: "public",
        state: "WAITING",
        codeHash: null,
        creatorIdentity: randomUUID(),
        createdAt: new Date(),
        expiresAt: null,
      },
      {
        id: privateId,
        topicId: privateId,
        name: "Demo: Should public transit be free?",
        side0: "Yes: everyone benefits from access",
        side1: "No: riders should share the cost",
        visibility: "private",
        state: "WAITING",
        codeHash: hashLobbyCode(privateCode),
        creatorIdentity: randomUUID(),
        createdAt: new Date(),
        expiresAt: null,
      },
    ];
    for (const topic of topics) {
      const existing = await store.findById(topic.id);
      if (existing) {
        if (
          existing.topicId !== topic.topicId ||
          existing.name !== topic.name ||
          existing.visibility !== topic.visibility ||
          existing.codeHash !== topic.codeHash
        ) {
          throw new Error(`Existing demo topic ${topic.id} does not match.`);
        }
        continue;
      }
      if (await store.hasCreatedName(topic.name)) {
        throw new Error(`Topic ${topic.name} already exists with another ID.`);
      }
      await store.create(topic);
    }
  } finally {
    await orm.close(true);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const databaseUrl = process.env.DATABASE_URL;
  const privateCode = process.env.DEMO_PRIVATE_CODE;
  if (!databaseUrl || !privateCode) {
    throw new Error("DATABASE_URL and DEMO_PRIVATE_CODE are required.");
  }
  await seedDemoTopics(databaseUrl, privateCode);
}
