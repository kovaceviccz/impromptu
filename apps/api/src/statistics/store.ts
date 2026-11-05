export type DebateOutcome = "win" | "loss" | "draw";

export type AccountStatistics = {
  totalDebates: number;
  wins: number;
  losses: number;
  winPercentage: number;
};

export type DebateParticipantResult = {
  accountId: string;
  sideIndex: 0 | 1;
};

export interface DebateResultStore {
  recordResults(
    lobbyId: string,
    participants: DebateParticipantResult[],
    winningSide: 0 | 1 | null,
  ): Promise<void>;
  statisticsFor(accountId: string): Promise<AccountStatistics>;
}

export function calculateStatistics(
  outcomes: DebateOutcome[],
): AccountStatistics {
  const totalDebates = outcomes.length;
  const wins = outcomes.filter((outcome) => outcome === "win").length;
  const losses = outcomes.filter((outcome) => outcome === "loss").length;
  return {
    totalDebates,
    wins,
    losses,
    winPercentage:
      totalDebates === 0 ? 0 : Number(((wins / totalDebates) * 100).toFixed(2)),
  };
}

export function createMemoryDebateResultStore(): DebateResultStore {
  const results = new Map<string, DebateOutcome>();

  return {
    async recordResults(lobbyId, participants, winningSide) {
      for (const participant of participants) {
        const key = `${lobbyId}:${participant.accountId}`;
        if (results.has(key)) continue;
        results.set(
          key,
          winningSide === null
            ? "draw"
            : participant.sideIndex === winningSide
              ? "win"
              : "loss",
        );
      }
    },
    async statisticsFor(accountId) {
      return calculateStatistics(
        [...results]
          .filter(([key]) => key.endsWith(`:${accountId}`))
          .map(([, outcome]) => outcome),
      );
    },
  };
}
