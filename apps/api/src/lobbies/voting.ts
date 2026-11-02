export type Voting = {
  endsAt: string;
  eligible: string[];
  votes: Record<string, "0" | "1" | null>;
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
  return {
    votingEndsAt: voting?.endsAt ?? null,
    voteCounts: [
      Object.values(voting?.votes ?? {}).filter((v) => v === "0").length,
      Object.values(voting?.votes ?? {}).filter((v) => v === "1").length,
    ] as [number, number],
    selectedVote: identity ? (voting?.votes[identity] ?? null) : null,
  };
}
