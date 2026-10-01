import {
  PRODUCT,
  type PrivateLobbyPreview,
  type TopicStatus,
} from "@impromptu/api/contracts";
import { LockKeyholeIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  Form,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

import {
  createPrivateTopic,
  getTopics,
  joinTopicByCode,
  lookupPrivateLobby,
} from "../api";

export const MEDIA_PERMISSION_MESSAGE =
  "Video and audio permissions must be given. Try again.";

export function meta() {
  return [
    { title: PRODUCT.name },
    {
      name: "description",
      content: "Choose a topic, take a side, and debate it live.",
    },
  ];
}

export async function clientLoader() {
  return getTopics();
}

type Selection = {
  topic: TopicStatus;
  sideIndex: 0 | 1;
};

const sideIndexes = [0, 1] as const;
type LobbyChoice = "spectator" | "0" | "1";

function parseLobbyChoice(value: string): LobbyChoice {
  return value === "0" || value === "1" ? value : "spectator";
}

function parseSideIndex(value: LobbyChoice): 0 | 1 | undefined {
  if (value === "0") return 0;
  if (value === "1") return 1;
  return undefined;
}

function PrivateLobby({ topics }: { topics: TopicStatus[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [topicId, setTopicId] = useState(topics[0]?.id ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [joinerName, setJoinerName] = useState("");
  const [creatorChoice, setCreatorChoice] = useState<LobbyChoice>("0");
  const [joinChoice, setJoinChoice] = useState<LobbyChoice>("spectator");
  const [preview, setPreview] = useState<PrivateLobbyPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function createLobby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const sideIndex = parseSideIndex(creatorChoice);
      const input =
        sideIndex === undefined
          ? { displayName: creatorName.trim(), intent: "spectator" as const }
          : {
              displayName: creatorName.trim(),
              intent: "debater" as const,
              sideIndex,
            };
      const result = await createPrivateTopic(topicId, input);
      if ("code" in result) {
        setError(result.message);
        return;
      }
      await navigate(`/debates/${result.topicId}`, {
        state: { joinResult: result },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Lobby could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function findLobby() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await lookupPrivateLobby(joinCode.trim().toUpperCase());
      setPreview(result);
      const firstOpenSide = result.sideAvailability.findIndex(Boolean);
      setJoinChoice(
        firstOpenSide === -1
          ? "spectator"
          : parseLobbyChoice(String(firstOpenSide)),
      );
    } catch (cause) {
      setPreview(undefined);
      setError(
        cause instanceof Error ? cause.message : "Lobby could not be found.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function joinLobby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      const code = joinCode.trim().toUpperCase();
      const sideIndex = parseSideIndex(joinChoice);
      const input =
        sideIndex === undefined
          ? {
              code,
              displayName: joinerName.trim(),
              intent: "spectator" as const,
            }
          : {
              code,
              displayName: joinerName.trim(),
              intent: "debater" as const,
              sideIndex,
            };
      const result = await joinTopicByCode(input);
      if ("code" in result) {
        setError(result.message);
        setPreview(undefined);
        return;
      }
      await navigate(`/debates/${result.topicId}`, {
        state: { joinResult: result },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Lobby could not be joined.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className="fixed right-4 bottom-4 z-40 h-11 shadow-lg sm:right-8 sm:bottom-8"
        type="button"
        onClick={() => setOpen(true)}
      >
        <LockKeyholeIcon aria-hidden="true" />
        Private lobby
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setError(undefined);
        }}
      >
        <DialogContent className="gap-5 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-editorial text-xl">
              Private lobby
            </DialogTitle>
            <DialogDescription>
              Create a lobby code or join with one.
            </DialogDescription>
          </DialogHeader>

          <section className="grid gap-3">
            <h2 className="font-medium">Create a lobby</h2>
            <form className="grid gap-3" onSubmit={createLobby}>
              <label className="grid gap-1.5 text-sm" htmlFor="private-topic">
                Topic
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="private-topic"
                  value={topicId}
                  onChange={(event) => {
                    setTopicId(event.target.value);
                  }}
                >
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm" htmlFor="creator-name">
                Creator display name
                <Input
                  autoComplete="nickname"
                  id="creator-name"
                  maxLength={40}
                  pattern=".*\S.*"
                  required
                  value={creatorName}
                  onChange={(event) => setCreatorName(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm" htmlFor="creator-side">
                Join as
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="creator-side"
                  value={creatorChoice}
                  onChange={(event) =>
                    setCreatorChoice(parseLobbyChoice(event.target.value))
                  }
                >
                  {topics
                    .find((topic) => topic.id === topicId)
                    ?.sides.map((side, sideIndex) => (
                      <option key={side} value={sideIndex}>
                        {side}
                      </option>
                    ))}
                  <option value="spectator">Spectate</option>
                </select>
              </label>
              <Button disabled={busy || topics.length === 0} type="submit">
                {busy ? "Please wait…" : "Create and join"}
              </Button>
            </form>
          </section>

          <section className="grid gap-3 border-t pt-4">
            <h2 className="font-medium">Join a lobby</h2>
            <form className="grid gap-3" onSubmit={joinLobby}>
              <label className="grid gap-1.5 text-sm" htmlFor="lobby-code">
                Lobby code
                <Input
                  autoCapitalize="characters"
                  autoComplete="off"
                  id="lobby-code"
                  maxLength={8}
                  minLength={6}
                  pattern="[A-Za-z0-9]{6,8}"
                  required
                  value={joinCode}
                  onChange={(event) => {
                    setJoinCode(event.target.value.toUpperCase());
                    setPreview(undefined);
                  }}
                />
              </label>
              <Button
                disabled={busy || joinCode.trim().length < 6}
                type="button"
                variant="outline"
                onClick={() => void findLobby()}
              >
                Find lobby
              </Button>
              {preview ? (
                <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
                  <div>
                    <p className="font-medium">{preview.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {preview.debaterCount} debating · {preview.spectatorCount}{" "}
                      watching
                    </p>
                  </div>
                  <label className="grid gap-1.5 text-sm" htmlFor="join-side">
                    Position
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      id="join-side"
                      value={joinChoice}
                      onChange={(event) =>
                        setJoinChoice(parseLobbyChoice(event.target.value))
                      }
                    >
                      {preview.sideAvailability.map((available, sideIndex) =>
                        available ? (
                          <option key={sideIndex} value={sideIndex}>
                            {preview.sides[sideIndex]}
                          </option>
                        ) : null,
                      )}
                      <option value="spectator">Spectate</option>
                    </select>
                  </label>
                </div>
              ) : null}
              <label
                className="grid gap-1.5 text-sm"
                htmlFor="lobby-display-name"
              >
                Your display name
                <Input
                  autoComplete="nickname"
                  id="lobby-display-name"
                  maxLength={40}
                  pattern=".*\S.*"
                  required
                  value={joinerName}
                  onChange={(event) => setJoinerName(event.target.value)}
                />
              </label>
              <Button disabled={busy || !preview} type="submit">
                {busy ? "Please wait…" : "Join private lobby"}
              </Button>
            </form>
          </section>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TopicList({ topics }: { topics: TopicStatus[] }) {
  const [selection, setSelection] = useState<Selection>();
  const navigation = useNavigation();
  const isJoining = navigation.state === "submitting";

  if (topics.length === 0) {
    return (
      <>
        <p className="m-auto text-center text-muted-foreground">
          No debates are available right now.
        </p>
        <PrivateLobby topics={topics} />
      </>
    );
  }

  return (
    <>
      <section aria-label="Debate topics" className="flex flex-col gap-3">
        <header className="flex items-end justify-between gap-4">
          <h1 className="text-base font-medium tracking-tight text-muted-foreground sm:text-lg">
            Choose a topic and side to debate
          </h1>
          <p className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {topics.length} available
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => (
            <Card
              className="min-h-[32rem] min-w-0 gap-0 overflow-hidden bg-card py-0 ring-0"
              key={topic.id}
            >
              <header className="grid min-h-24 content-center gap-3 px-5 py-4 sm:min-h-28 sm:px-7">
                <h2 className="font-editorial min-w-0 break-words text-[clamp(1.25rem,3vw,2.2rem)] leading-none font-semibold tracking-tight">
                  {topic.title}
                </h2>
                <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    {topic.debaterCount === 0
                      ? "Both sides open"
                      : topic.debaterCount === 1
                        ? "One side open"
                        : "Both sides taken"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {topic.spectatorCount === 0
                      ? "No one watching"
                      : `${topic.spectatorCount} ${
                          topic.spectatorCount === 1 ? "person" : "people"
                        } watching`}
                  </span>
                </p>
              </header>

              <CardContent className="grid min-h-0 flex-1 grid-cols-2 bg-transparent p-0">
                {sideIndexes.map((sideIndex) => {
                  const side = topic.sides[sideIndex];
                  const available = topic.sideAvailability[sideIndex];

                  return (
                    <section
                      className={
                        "flex min-w-0 flex-col gap-4 px-4 pt-4 pb-4 sm:px-7 sm:pt-7 " +
                        (sideIndex === 0 ? "bg-emerald-50" : "bg-red-50")
                      }
                      key={side}
                    >
                      <h3
                        className={
                          "font-editorial min-w-0 break-words text-xl leading-snug font-semibold sm:text-2xl " +
                          (sideIndex === 0
                            ? "text-emerald-800"
                            : "text-red-800")
                        }
                      >
                        {side}
                      </h3>
                      <Button
                        className={
                          "mt-auto h-11 w-full text-base " +
                          (sideIndex === 0
                            ? "bg-emerald-800 text-white hover:bg-emerald-900"
                            : "bg-red-800 text-white hover:bg-red-900")
                        }
                        disabled={!available}
                        size="lg"
                        type="button"
                        onClick={() => setSelection({ topic, sideIndex })}
                      >
                        {available ? "Debate" : "Side taken"}
                        <span className="sr-only">: {side}</span>
                      </Button>
                    </section>
                  );
                })}
              </CardContent>

              <footer>
                <Form
                  action={"/debates/" + topic.id}
                  className="w-full"
                  method="post"
                >
                  <input name="intent" type="hidden" value="spectator" />
                  <Button
                    className="h-14 w-full rounded-none bg-card text-base hover:bg-[#f5f8fb] active:not-aria-[haspopup]:translate-y-0"
                    size="lg"
                    type="submit"
                    variant="secondary"
                  >
                    Watch live
                  </Button>
                </Form>
              </footer>
            </Card>
          ))}
        </div>
      </section>

      <Dialog
        open={selection !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelection(undefined);
        }}
      >
        <DialogContent>
          {selection ? (
            <Form
              action={"/debates/" + selection.topic.id}
              className="grid gap-4"
              method="post"
            >
              <DialogHeader>
                <DialogTitle className="font-editorial text-xl">
                  Debate this topic
                </DialogTitle>
                <DialogDescription>{selection.topic.title}</DialogDescription>
              </DialogHeader>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Your position
                </p>
                <p className="font-medium">
                  {selection.topic.sides[selection.sideIndex]}
                </p>
              </div>
              <div>
                <label className="sr-only" htmlFor="display-name">
                  Display name
                </label>
                <Input
                  autoComplete="nickname"
                  id="display-name"
                  maxLength={40}
                  name="displayName"
                  pattern=".*\S.*"
                  placeholder="Display name"
                  required
                  title="Enter a display name."
                />
              </div>
              <input name="intent" type="hidden" value="debater" />
              <input
                name="sideIndex"
                type="hidden"
                value={selection.sideIndex}
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelection(undefined)}
                >
                  Cancel
                </Button>
                <Button disabled={isJoining} type="submit">
                  Debate
                </Button>
              </div>
            </Form>
          ) : null}
        </DialogContent>
      </Dialog>
      <PrivateLobby topics={topics} />
    </>
  );
}

export default function Home() {
  const topics = useLoaderData<typeof clientLoader>();
  const location = useLocation();
  const navigate = useNavigate();
  const arrivedAfterMediaPermissionFailure =
    typeof location.state === "object" &&
    location.state !== null &&
    "mediaPermissionFailure" in location.state &&
    location.state.mediaPermissionFailure === true;
  const [showMediaPermissionFailure] = useState(
    arrivedAfterMediaPermissionFailure,
  );

  useEffect(() => {
    if (!showMediaPermissionFailure) return;

    void navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { preventScrollReset: true, replace: true, state: null },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    showMediaPermissionFailure,
  ]);

  return (
    <main className="min-h-svh bg-background">
      <header className="bg-[#f8fafc]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-4 sm:px-6">
          <p className="font-editorial text-xl font-semibold tracking-tight text-primary">
            {PRODUCT.name}
          </p>
        </div>
      </header>
      <section className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6 sm:py-5">
        {showMediaPermissionFailure ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {MEDIA_PERMISSION_MESSAGE}
          </p>
        ) : null}
        <TopicList topics={topics} />
      </section>
    </main>
  );
}
