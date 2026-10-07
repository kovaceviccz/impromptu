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
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = nextCode();
    const codeHash = hashLobbyCode(code);
    if (await store.findByCodeHash(codeHash)) continue;

    const lobby: PrivateLobbyRecord = {
      id: randomUUID(),
      topicId,
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

export async function findPrivateLobbyByCode(
  store: PrivateLobbyStore,
  code: string,
) {
  return store.findByCodeHash(hashLobbyCode(code));
}
