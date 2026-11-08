import { recordVote, type Voting } from "./voting.js";
import type { LobbyState } from "./contract.js";

export type PublicLobbyState = {
  topicId: string;
  hostIdentity: string | null;
  state: LobbyState;
  roundEndsAt?: Date | null;
  voting?: Voting | null;
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
    roundEndsAt?: Date | null,
    voting?: Voting | null,
  ): Promise<boolean>;
  dueRounds(now: Date): Promise<PublicLobbyState[]>;
  dueVotes(now: Date): Promise<PublicLobbyState[]>;
  submitVote(
    id: string,
    identity: string,
    choice: "0" | "1" | null,
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
    async updateState(topicId, expectedState, state, roundEndsAt, voting) {
      const current = states.get(topicId);
      if (!current || current.state !== expectedState) return false;
      states.set(topicId, {
        ...current,
        state,
        ...(roundEndsAt !== undefined ? { roundEndsAt } : {}),
        ...(voting !== undefined ? { voting } : {}),
      });
      return true;
    },
    async dueRounds(now) {
      return [...states.values()].filter(
        (lobby) =>
          lobby.state === "DEBATE_IN_PROGRESS" &&
          lobby.roundEndsAt &&
          lobby.roundEndsAt <= now,
      );
    },
    async dueVotes(now) {
      return [...states.values()].filter(
        (lobby) =>
          lobby.state === "VOTING" &&
          lobby.voting &&
          Date.parse(lobby.voting.endsAt) <= now.getTime(),
      );
    },
    async submitVote(id, identity, choice) {
      const current = states.get(id);
      if (!current || current.state !== "VOTING") return false;
      const voting = recordVote(current.voting, identity, choice, new Date());
      if (!voting) return false;
      states.set(id, { ...current, voting });
      return true;
    },
    async close() {},
  };
}
