export type Voting = {
  roundId?: string;
  endsAt: string;
  eligible: string[];
  votes: Record<string, "0" | "1" | null>;
  debaters?: Partial<Record<"0" | "1", string>>;
  debaterNames?: Partial<Record<"0" | "1", string>>;
};

export function recordVote(
  voting: Voting | null | undefined,
  identity: string,
  choice: "0" | "1" | null,
  now: Date,
): Voting | undefined {
  if (
    !voting ||
    now.getTime() >= Date.parse(voting.endsAt) ||
    !voting.eligible.includes(identity)
  )
    return undefined;
  return { ...voting, votes: { ...voting.votes, [identity]: choice } };
}

export function votingSummary(voting?: Voting | null, identity?: string) {
  const voteCounts: [number, number] = [
    Object.values(voting?.votes ?? {}).filter((v) => v === "0").length,
    Object.values(voting?.votes ?? {}).filter((v) => v === "1").length,
  ];
  const winningSide: 0 | 1 | null =
    voteCounts[0] === voteCounts[1]
      ? null
      : voteCounts[0] > voteCounts[1]
        ? 0
        : 1;
  return {
    votingEndsAt: voting?.endsAt ?? null,
    voteCounts,
    selectedVote: identity ? (voting?.votes[identity] ?? null) : null,
    voteEligible: identity
      ? (voting?.eligible.includes(identity) ?? false)
      : false,
    results:
      voting && Date.now() >= Date.parse(voting.endsAt)
        ? {
            debaters: [
              {
                name: voting.debaterNames?.["0"] ?? "Debater 1",
                votes: voteCounts[0],
              },
              {
                name: voting.debaterNames?.["1"] ?? "Debater 2",
                votes: voteCounts[1],
              },
            ] as [
              { name: string; votes: number },
              { name: string; votes: number },
            ],
            winningSide,
          }
        : null,
  };
}
