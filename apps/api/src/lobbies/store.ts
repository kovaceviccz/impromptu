import type { LobbyState } from "./contract.js";

export class DuplicateLobbyCodeError extends Error {}
export class DuplicateTopicNameError extends Error {}

export type PrivateLobbyRecord = {
  id: string;
  topicId: string;
  name?: string;
  side0?: string | null;
  side1?: string | null;
  visibility?: "public" | "private";
  state: LobbyState;
  codeHash: string | null;
  creatorIdentity: string;
  createdAt: Date;
  expiresAt: Date | null;
};

export interface PrivateLobbyStore {
  create(lobby: PrivateLobbyRecord): Promise<void>;
  listPublic(): Promise<PrivateLobbyRecord[]>;
  hasCreatedName(name: string): Promise<boolean>;
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
        lobby.topicId === lobby.id &&
        [...lobbies.values()].some(
          (existing) =>
            existing.topicId === existing.id &&
            existing.name?.toLocaleLowerCase() ===
              lobby.name?.toLocaleLowerCase(),
        )
      ) {
        throw new DuplicateTopicNameError("Topic already exists");
      }
      if (
        lobby.codeHash &&
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
    async listPublic() {
      return [...lobbies.values()]
        .filter(
          (lobby) => lobby.visibility === "public" && lobby.state !== "ENDED",
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async hasCreatedName(name) {
      return [...lobbies.values()].some(
        (lobby) =>
          lobby.topicId === lobby.id &&
          lobby.name?.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
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
