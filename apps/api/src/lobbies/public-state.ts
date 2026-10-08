import type { LobbyState } from "./contract.js";

export type PublicLobbyState = {
  topicId: string;
  hostIdentity: string | null;
  state: LobbyState;
};

export interface PublicLobbyStateStore {
  claimHost(topicId: string, identity: string): Promise<PublicLobbyState>;
  find(topicId: string): Promise<PublicLobbyState | undefined>;
  updateHost(
    topicId: string,
    expectedIdentity: string,
    identity: string | null,
  ): Promise<boolean>;
  updateState(
    topicId: string,
    expectedState: LobbyState,
    state: LobbyState,
  ): Promise<boolean>;
  close(): Promise<void>;
}

export function createMemoryPublicLobbyStateStore(
  initial: PublicLobbyState[] = [],
): PublicLobbyStateStore {
  const states = new Map(initial.map((state) => [state.topicId, state]));

  return {
    async claimHost(topicId, identity) {
      const current = states.get(topicId) ?? {
        topicId,
        hostIdentity: null,
        state: "WAITING" as const,
      };
      const claimed =
        current.hostIdentity === null
          ? { ...current, hostIdentity: identity }
          : current;
      states.set(topicId, claimed);
      return claimed;
    },
    async find(topicId) {
      return states.get(topicId);
    },
    async updateHost(topicId, expectedIdentity, identity) {
      const current = states.get(topicId);
      if (!current || current.hostIdentity !== expectedIdentity) return false;
      states.set(topicId, { ...current, hostIdentity: identity });
      return true;
    },
    async updateState(topicId, expectedState, state) {
      const current = states.get(topicId);
      if (!current || current.state !== expectedState) return false;
      states.set(topicId, { ...current, state });
      return true;
    },
    async close() {},
  };
}
