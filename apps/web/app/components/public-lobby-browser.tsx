import type { PublicLobbySummary } from "@impromptu/api/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; lobbies: PublicLobbySummary[] };

export function PublicLobbyCard({ lobby }: { lobby: PublicLobbySummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{lobby.question}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="mt-auto flex items-center justify-between gap-3">
        <span>
          {lobby.participantCount}{" "}
          {lobby.participantCount === 1 ? "participant" : "participants"}
        </span>
        <span>{lobby.status === "waiting" ? "Waiting" : "Active"}</span>
      </CardContent>
    </Card>
  );
}

export function PublicLobbyBrowser({
  loadLobbies,
}: {
  loadLobbies: () => Promise<PublicLobbySummary[]>;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequest = attempt;
    let active = true;
    void loadLobbies().then(
      (lobbies) => {
        if (active && currentRequest === requestId.current) {
          setState({ kind: "ready", lobbies });
        }
      },
      () => {
        if (active && currentRequest === requestId.current) {
          setState({ kind: "error" });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, loadLobbies]);

  if (state.kind === "loading") {
    return <output>Loading public lobbies…</output>;
  }

  if (state.kind === "error") {
    return (
      <div role="alert">
        <p>Could not load public lobbies.</p>
        <Button
          onClick={() => {
            setState({ kind: "loading" });
            requestId.current++;
            setAttempt(requestId.current);
          }}
          type="button"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (state.lobbies.length === 0) {
    return <p>No public lobbies are available right now.</p>;
  }

  const sorted = [...state.lobbies].sort(
    (a, b) => a.question.localeCompare(b.question) || a.id.localeCompare(b.id),
  );

  return (
    <section aria-label="Public lobbies" className="grid gap-3 sm:grid-cols-2">
      {sorted.map((lobby) => (
        <PublicLobbyCard key={lobby.id} lobby={lobby} />
      ))}
    </section>
  );
}
