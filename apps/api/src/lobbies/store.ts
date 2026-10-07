import type { LobbyState } from "./contract.js";

export class DuplicateLobbyCodeError extends Error {}

export type PrivateLobbyRecord = {
  id: string;
  topicId: string;
  state: LobbyState;
  codeHash: string;
  creatorIdentity: string;
  createdAt: Date;
  expiresAt: Date | null;
};

export interface PrivateLobbyStore {
  create(lobby: PrivateLobbyRecord): Promise<void>;
  findByCodeHash(codeHash: string): Promise<PrivateLobbyRecord | undefined>;
  findById(id: string): Promise<PrivateLobbyRecord | undefined>;
  updateState(
    id: string,
    expectedState: LobbyState,
    state: LobbyState,
  ): Promise<boolean>;
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}

export function createMemoryPrivateLobbyStore(
  initial: PrivateLobbyRecord[] = [],
): PrivateLobbyStore {
  const lobbies = new Map(initial.map((lobby) => [lobby.id, lobby]));

  return {
    async create(lobby) {
      if (
        [...lobbies.values()].some(
          (existing) => existing.codeHash === lobby.codeHash,
        )
      ) {
        throw new DuplicateLobbyCodeError("Private lobby code already exists");
      }
      lobbies.set(lobby.id, lobby);
    },
    async findByCodeHash(codeHash) {
      return [...lobbies.values()].find((lobby) => lobby.codeHash === codeHash);
    },
    async findById(id) {
      return lobbies.get(id);
    },
    async updateState(id, expectedState, state) {
      const lobby = lobbies.get(id);
      if (!lobby || lobby.state !== expectedState) return false;
      lobbies.set(id, { ...lobby, state });
      return true;
    },
    async delete(id) {
      lobbies.delete(id);
    },
    async close() {},
  };
}
