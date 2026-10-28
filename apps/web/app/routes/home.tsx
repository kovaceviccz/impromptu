import {
  PRODUCT,
  apiContract,
  type PrivateLobbyPreview,
  topicPresets,
  type TopicStatus,
} from "@impromptu/api/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockKeyholeIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Form,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";

import { Button } from "~/components/ui/button";
import { SiteHeader } from "~/components/site-header";
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
  createLobby as createLobbyRequest,
  getSession,
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
  const [topics, account] = await Promise.all([
    getTopics(),
    // Topics remain usable when the session cannot be read.
    getSession().then(
      (session) => session.account,
      () => null,
    ),
  ]);
  return { account, topics };
}

const topicCategoryStyles = {
  Philosophy: "border-violet-200 bg-violet-100 text-violet-900",
  Society: "border-sky-200 bg-sky-100 text-sky-900",
  Sports: "border-emerald-200 bg-emerald-100 text-emerald-900",
  Music: "border-amber-200 bg-amber-100 text-amber-900",
  Entertainment: "border-pink-200 bg-pink-100 text-pink-900",
} as const;

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

function PrivateLobby({
  defaultDisplayName = "",
}: {
  defaultDisplayName?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [topicBrowserOpen, setTopicBrowserOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [activeMode, setActiveMode] = useState<"create" | "join">("create");
  const [topicSource, setTopicSource] = useState<"preset" | "custom">("preset");
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    topicPresets[0].id,
  );
  const [lobbyName, setLobbyName] = useState<string>(topicPresets[0].title);
  const [affirmative, setAffirmative] = useState<string>(
    topicPresets[0].sides[0],
  );
  const [opposing, setOpposing] = useState<string>(topicPresets[0].sides[1]);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [joinCode, setJoinCode] = useState("");
  const [creatorName, setCreatorName] = useState(defaultDisplayName);
  const [joinerName, setJoinerName] = useState(defaultDisplayName);
  const [creatorChoice, setCreatorChoice] = useState<LobbyChoice>("0");
  const [joinChoice, setJoinChoice] = useState<LobbyChoice>("spectator");
  const [preview, setPreview] = useState<PrivateLobbyPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function createLobby(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lobbyName.trim()) {
      setError("Enter a topic question.");
      return;
    }
    if (!affirmative.trim() || !opposing.trim()) {
      setError("Enter both argument positions.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const sideIndex = parseSideIndex(creatorChoice);
      const input =
        sideIndex === undefined
          ? {
              name: lobbyName.trim(),
              sides: [affirmative.trim(), opposing.trim()] as [string, string],
              visibility,
              displayName: creatorName.trim(),
              intent: "spectator" as const,
            }
          : {
              name: lobbyName.trim(),
              sides: [affirmative.trim(), opposing.trim()] as [string, string],
              visibility,
              displayName: creatorName.trim(),
              intent: "debater" as const,
              sideIndex,
            };
      const result = await createLobbyRequest(input);
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
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,8}$/.test(code)) {
      setPreview(undefined);
      setError("Enter a 6–8 character lobby code using letters and numbers.");
      return;
    }
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
        className="fixed right-4 bottom-4 z-40 h-11 text-base sm:right-6 sm:bottom-6"
        size="lg"
        type="button"
        onClick={() => setOpen(true)}
      >
        <LockKeyholeIcon aria-hidden="true" />
        Create or Join
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setError(undefined);
        }}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-editorial text-xl">
              Create or Join
            </DialogTitle>
            <DialogDescription>
              Create a public or private debate topic, or join with a code.
            </DialogDescription>
          </DialogHeader>

          <div
            aria-label="Lobby action"
            className="grid grid-cols-2 rounded-lg border bg-muted p-1"
            role="tablist"
          >
            <button
              aria-controls="create-lobby-panel"
              aria-selected={activeMode === "create"}
              className={
                "rounded-md px-3 py-2 text-sm font-medium " +
                (activeMode === "create"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              id="create-lobby-tab"
              role="tab"
              tabIndex={activeMode === "create" ? 0 : -1}
              type="button"
              onClick={() => {
                setActiveMode("create");
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  setActiveMode("join");
                  setError(undefined);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>("#join-lobby-tab")
                    ?.focus();
                }
              }}
            >
              Create
            </button>
            <button
              aria-controls="join-lobby-panel"
              aria-selected={activeMode === "join"}
              className={
                "rounded-md px-3 py-2 text-sm font-medium " +
                (activeMode === "join"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              id="join-lobby-tab"
              role="tab"
              tabIndex={activeMode === "join" ? 0 : -1}
              type="button"
              onClick={() => {
                setActiveMode("join");
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  setActiveMode("create");
                  setError(undefined);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>("#create-lobby-tab")
                    ?.focus();
                }
              }}
            >
              Join
            </button>
          </div>

          {activeMode === "create" ? (
            <section
              aria-labelledby="create-lobby-tab"
              className="grid gap-3"
              id="create-lobby-panel"
              role="tabpanel"
            >
              <form className="grid gap-3" onSubmit={createLobby}>
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1.5 text-sm">Topic source</legend>
                  <div
                    className="grid grid-cols-2 rounded-lg border bg-muted p-1"
                    role="radiogroup"
                  >
                    <label
                      className={
                        "cursor-pointer rounded-md px-3 py-2 text-center text-sm font-medium " +
                        (topicSource === "preset"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground")
                      }
                    >
                      <input
                        checked={topicSource === "preset"}
                        className="sr-only"
                        name="topic-source"
                        type="radio"
                        onChange={() => {
                          const preset = topicPresets.find(
                            (topic) => topic.id === selectedPresetId,
                          );
                          setTopicSource("preset");
                          if (preset) {
                            setLobbyName(preset.title);
                            setAffirmative(preset.sides[0]);
                            setOpposing(preset.sides[1]);
                          }
                        }}
                      />
                      Choose a topic
                    </label>
                    <label
                      className={
                        "cursor-pointer rounded-md px-3 py-2 text-center text-sm font-medium " +
                        (topicSource === "custom"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground")
                      }
                    >
                      <input
                        checked={topicSource === "custom"}
                        className="sr-only"
                        name="topic-source"
                        type="radio"
                        onChange={() => {
                          setTopicSource("custom");
                          setLobbyName("");
                          setAffirmative("");
                          setOpposing("");
                        }}
                      />
                      Write your own
                    </label>
                  </div>
                </fieldset>

                {topicSource === "preset" ? (
                  <Button
                    aria-label="Select prewritten topic"
                    className="justify-center"
                    type="button"
                    variant="outline"
                    onClick={() => setTopicBrowserOpen(true)}
                  >
                    Select prewritten topic
                  </Button>
                ) : null}

                <label className="grid gap-1.5 text-sm" htmlFor="lobby-name">
                  Topic question
                  <Input
                    id="lobby-name"
                    maxLength={80}
                    pattern=".*\S.*"
                    required
                    value={lobbyName}
                    onChange={(event) => setLobbyName(event.target.value)}
                    onInvalid={() => setError("Enter a topic question.")}
                  />
                </label>
                <label
                  className="grid gap-1.5 text-sm"
                  htmlFor="affirmative-position"
                >
                  Affirmative position
                  <Input
                    id="affirmative-position"
                    maxLength={120}
                    required
                    value={affirmative}
                    onChange={(event) => setAffirmative(event.target.value)}
                    onInvalid={() => setError("Enter both argument positions.")}
                  />
                </label>
                <label
                  className="grid gap-1.5 text-sm"
                  htmlFor="opposing-position"
                >
                  Opposing position
                  <Input
                    id="opposing-position"
                    maxLength={120}
                    required
                    value={opposing}
                    onChange={(event) => setOpposing(event.target.value)}
                    onInvalid={() => setError("Enter both argument positions.")}
                  />
                </label>
                <label
                  className="grid gap-1.5 text-sm"
                  htmlFor="lobby-visibility"
                >
                  Visibility
                  <select
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    id="lobby-visibility"
                    value={visibility}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === "public" || next === "private")
                        setVisibility(next);
                    }}
                  >
                    <option value="public">Public</option>
                    <option value="private">Private</option>
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
                    onInvalid={() => setError("Enter a display name.")}
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
                    <option value="0">{affirmative || "Affirmative"}</option>
                    <option value="1">{opposing || "Opposing"}</option>
                    <option value="spectator">Spectate</option>
                  </select>
                </label>
                <Button disabled={busy} type="submit">
                  {busy ? "Please wait…" : "Create and join"}
                </Button>
              </form>
            </section>
          ) : (
            <section
              aria-labelledby="join-lobby-tab"
              className="grid gap-3"
              id="join-lobby-panel"
              role="tabpanel"
            >
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
                  disabled={busy || !joinCode.trim()}
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
                        {preview.debaterCount} debating ·{" "}
                        {preview.spectatorCount} watching
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
          )}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={topicBrowserOpen} onOpenChange={setTopicBrowserOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Browse topics</DialogTitle>
            <DialogDescription>
              Choose one or more categories to find a prewritten topic.
            </DialogDescription>
          </DialogHeader>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Categories</legend>
            <div className="flex flex-wrap gap-2">
              {Array.from(
                new Set(topicPresets.map((topic) => topic.category)),
              ).map((category) => (
                <label
                  className={
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm " +
                    topicCategoryStyles[category]
                  }
                  key={category}
                >
                  <input
                    checked={selectedCategories.includes(category)}
                    type="checkbox"
                    onChange={(event) => {
                      setSelectedCategories((categories) =>
                        event.target.checked
                          ? [...categories, category]
                          : categories.filter((item) => item !== category),
                      );
                    }}
                  />
                  {category}
                </label>
              ))}
            </div>
          </fieldset>

          {selectedCategories.length > 0 ? (
            <section className="grid gap-2" aria-live="polite">
              <h3 className="text-sm font-medium">Topics</h3>
              {topicPresets
                .filter((topic) => selectedCategories.includes(topic.category))
                .map((topic) => (
                  <Button
                    className={
                      "h-auto justify-start px-3 py-2.5 text-left whitespace-normal " +
                      topicCategoryStyles[topic.category]
                    }
                    key={topic.id}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedPresetId(topic.id);
                      setLobbyName(topic.title);
                      setAffirmative(topic.sides[0]);
                      setOpposing(topic.sides[1]);
                      setTopicBrowserOpen(false);
                    }}
                  >
                    <span>{topic.title}</span>
                  </Button>
                ))}
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TopicList({
  defaultDisplayName,
  topics,
}: {
  defaultDisplayName?: string;
  topics: TopicStatus[];
}) {
  const [selection, setSelection] = useState<Selection>();
  const [selectedTopicIndex, setTopicIndex] = useState(0);
  const topicIndex = Math.min(
    selectedTopicIndex,
    Math.max(0, topics.length - 1),
  );
  const touchStart = useRef<number | undefined>(undefined);
  const navigation = useNavigation();
  const isJoining = navigation.state === "submitting";
  const topic = topics[topicIndex] ?? topics[0];

  if (!topic) {
    return (
      <>
        <p className="m-auto text-center text-muted-foreground">
          No debates are available right now.
        </p>
        <PrivateLobby defaultDisplayName={defaultDisplayName} />
      </>
    );
  }

  function moveTopic(offset: number) {
    setTopicIndex((topicIndex + offset + topics.length) % topics.length);
  }

  return (
    <>
      <section
        aria-label="Debate topics"
        className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3"
      >
        <header className="flex items-end justify-between gap-4">
          <h1 className="text-base font-medium tracking-tight text-muted-foreground sm:text-lg">
            Choose a topic and side to debate
          </h1>
          <p className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {topicIndex + 1} of {topics.length}
          </p>
        </header>

        <div className="relative min-h-0">
          <Card
            className="h-full min-h-0 gap-0 overflow-hidden bg-card py-0 ring-0"
            onTouchEnd={(event) => {
              if (touchStart.current === undefined) return;
              const distance =
                event.changedTouches[0]!.clientX - touchStart.current;
              if (Math.abs(distance) >= 60) moveTopic(distance < 0 ? 1 : -1);
              touchStart.current = undefined;
            }}
            onTouchStart={(event) => {
              touchStart.current = event.touches[0]!.clientX;
            }}
          >
            <header className="grid min-h-24 content-center gap-3 px-5 py-4 sm:min-h-28 sm:px-7">
              <h2 className="font-editorial max-w-full text-[clamp(1.5rem,5.5vw,2.75rem)] leading-tight font-semibold tracking-tight break-words">
                {topic.title}
              </h2>
              <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {topic.sideAvailability.every((available) => !available)
                    ? "No debate positions available"
                    : topic.sideAvailability.every(Boolean)
                      ? "Both sides open"
                      : "One side open"}
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
                const debater = topic.participants.find(
                  (participant) =>
                    participant.role === "debater" &&
                    participant.sideIndex === sideIndex,
                );

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
                        "font-editorial text-xl leading-snug font-semibold sm:text-2xl " +
                        (sideIndex === 0 ? "text-emerald-800" : "text-red-800")
                      }
                    >
                      {side}
                    </h3>
                    {debater ? (
                      <p className="text-sm">
                        {debater.displayName} is debating
                      </p>
                    ) : null}
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
                  disabled={isJoining}
                  size="lg"
                  type="submit"
                  variant="secondary"
                >
                  {isJoining && navigation.formAction === `/debates/${topic.id}`
                    ? "Joining…"
                    : "Watch live"}
                </Button>
              </Form>
            </footer>
          </Card>

          <Button
            className="absolute top-[calc(50%-1.125rem)] left-1 z-10 bg-transparent text-foreground/50 shadow-none transition-none hover:bg-transparent hover:text-foreground active:not-aria-[haspopup]:translate-y-0 sm:left-2"
            disabled={topics.length < 2}
            size="icon-lg"
            type="button"
            variant="ghost"
            onClick={() => moveTopic(-1)}
          >
            <ChevronLeftIcon />
            <span className="sr-only">Previous topic</span>
          </Button>
          <Button
            className="absolute top-[calc(50%-1.125rem)] right-1 z-10 bg-transparent text-foreground/50 shadow-none transition-none hover:bg-transparent hover:text-foreground active:not-aria-[haspopup]:translate-y-0 sm:right-2"
            disabled={topics.length < 2}
            size="icon-lg"
            type="button"
            variant="ghost"
            onClick={() => moveTopic(1)}
          >
            <ChevronRightIcon />
            <span className="sr-only">Next topic</span>
          </Button>
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
                  defaultValue={defaultDisplayName}
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
                  variant="secondary"
                  onClick={() => setSelection(undefined)}
                >
                  Cancel
                </Button>
                <Button disabled={isJoining} type="submit">
                  {isJoining ? "Joining…" : "Debate"}
                </Button>
              </div>
            </Form>
          ) : null}
        </DialogContent>
      </Dialog>
      <PrivateLobby defaultDisplayName={defaultDisplayName} />
    </>
  );
}

export default function Home() {
  const { account, topics: initialTopics } =
    useLoaderData<typeof clientLoader>();
  const [topics, setTopics] = useState(initialTopics);
  const [topicListError, setTopicListError] = useState<string>();
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
  const lobbyJoinError = new URLSearchParams(location.search).get("lobbyError");

  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    let active = true;
    let refreshVersion = 0;
    const events = new EventSource(apiContract.publicLobbyEvents.path);
    const refresh = () => {
      const version = ++refreshVersion;
      void getTopics().then(
        (latestTopics) => {
          if (!active || version !== refreshVersion) return;
          setTopics(latestTopics);
          setTopicListError(undefined);
        },
        () => {
          if (active && version === refreshVersion)
            setTopicListError("Debate topics could not be refreshed.");
        },
      );
    };
    events.addEventListener("changed", refresh);
    events.onopen = refresh;
    window.addEventListener("online", refresh);
    return () => {
      active = false;
      events.close();
      window.removeEventListener("online", refresh);
    };
  }, []);

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
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <SiteHeader account={account} />
      <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-5">
        {showMediaPermissionFailure ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {MEDIA_PERMISSION_MESSAGE}
          </p>
        ) : null}
        {lobbyJoinError ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {lobbyJoinError}
          </p>
        ) : null}
        {topicListError ? (
          <p className="text-sm text-destructive" role="alert">
            {topicListError}
          </p>
        ) : null}
        <TopicList
          defaultDisplayName={account?.displayName}
          key={location.key}
          topics={topics}
        />
      </section>
    </main>
  );
}
