import { createHash, randomInt, randomUUID } from "node:crypto";

import { UniqueConstraintViolationException } from "@mikro-orm/core";

import {
  DuplicateLobbyCodeError,
  type PrivateLobbyRecord,
  type PrivateLobbyStore,
} from "./store.js";

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeLength = 8;
const privateLobbyTtlMs = 24 * 60 * 60 * 1000;

export function hashLobbyCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function generateCode() {
  return Array.from(
    { length: codeLength },
    () => codeAlphabet[randomInt(codeAlphabet.length)],
  ).join("");
}

export async function createPrivateLobby(
  store: PrivateLobbyStore,
  topicId: string,
  creatorIdentity: string,
  nextCode: () => string = generateCode,
  name = topicId,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = nextCode();
    const codeHash = hashLobbyCode(code);
    if (await store.findByCodeHash(codeHash)) continue;

    const lobby: PrivateLobbyRecord = {
      id: randomUUID(),
      topicId,
      name,
      visibility: "private",
      state: "WAITING",
      codeHash,
      creatorIdentity,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + privateLobbyTtlMs),
    };

    try {
      await store.create(lobby);
      return { ...lobby, code };
    } catch (error) {
      if (
        error instanceof UniqueConstraintViolationException ||
        error instanceof DuplicateLobbyCodeError
      )
        continue;
      throw error;
    }
  }

  throw new Error("Unable to generate a unique private lobby code");
}

export async function createPublicLobby(
  store: PrivateLobbyStore,
  topicId: string,
  creatorIdentity: string,
  name: string,
) {
  const lobby: PrivateLobbyRecord = {
    id: randomUUID(),
    topicId,
    name,
    visibility: "public",
    state: "WAITING",
    codeHash: null,
    creatorIdentity,
    createdAt: new Date(),
    expiresAt: null,
  };
  await store.create(lobby);
  return lobby;
}

export async function createTopicLobby(
  store: PrivateLobbyStore,
  input: {
    name: string;
    sides: [string, string];
    visibility: "public" | "private";
    creatorIdentity: string;
  },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    const code = input.visibility === "private" ? generateCode() : undefined;
    const record: PrivateLobbyRecord = {
      id,
      topicId: id,
      name: input.name,
      side0: input.sides[0],
      side1: input.sides[1],
      visibility: input.visibility,
      state: "WAITING",
      codeHash: code ? hashLobbyCode(code) : null,
      creatorIdentity: input.creatorIdentity,
      createdAt: new Date(),
      expiresAt: null,
    };
    try {
      await store.create(record);
      return { ...record, code };
    } catch (error) {
      if (
        code &&
        (error instanceof DuplicateLobbyCodeError ||
          (error instanceof UniqueConstraintViolationException &&
            (await store.findByCodeHash(hashLobbyCode(code)))))
      )
        continue;
      throw error;
    }
  }
  throw new Error("Unable to generate a unique private lobby code");
}

export async function findPrivateLobbyByCode(
  store: PrivateLobbyStore,
  code: string,
) {
  return store.findByCodeHash(hashLobbyCode(code));
}
