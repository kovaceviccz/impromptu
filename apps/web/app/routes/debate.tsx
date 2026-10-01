import {
  PRODUCT,
  joinBodySchema,
  type JoinInput,
  type JoinResult,
} from "@impromptu/api/contracts";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useChat,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { LogOutIcon, SendIcon, SmileIcon } from "lucide-react";
import { Track, VideoPresets } from "livekit-client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type ClientActionFunctionArgs,
  Form,
  Link,
  Navigate,
  useActionData,
  useNavigate,
} from "react-router";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "~/components/ui/emoji-picker";
import { Input } from "~/components/ui/input";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "~/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "~/components/ui/message-scroller";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

import { joinTopic, leaveTopic } from "../api";

const VOTE_ATTRIBUTE = "debate.vote";
const SIDE_ATTRIBUTE = "debate.side";
const VIDEO_CAPTURE_720P = { resolution: VideoPresets.h720.resolution };
const chatTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const voteSurface =
  "flex h-14 min-w-24 basis-0 shrink items-center justify-between gap-2 rounded-lg px-3 text-left whitespace-normal transition-[flex-grow,background-color,color] duration-300 ease-out";
const sideTints = [
  "bg-emerald-50 text-emerald-900",
  "bg-red-50 text-red-900",
] as const;
const voteSurfaceColors = [
  "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 aria-pressed:bg-emerald-800 aria-pressed:text-white",
  "bg-red-50 text-red-800 hover:bg-red-100 aria-pressed:bg-red-800 aria-pressed:text-white",
] as const;

export function meta() {
  return [{ title: PRODUCT.name }];
}

export async function clientAction({
  params,
  request,
}: ClientActionFunctionArgs) {
  if (!params.topicId) throw new Response("Topic not found", { status: 404 });
  const formData = await request.formData();
  const values = Object.fromEntries(formData);
  const input = joinBodySchema.parse(
    values.intent === "debater"
      ? { ...values, sideIndex: Number(values.sideIndex) }
      : values,
  );
  return joinTopic(params.topicId, input);
}

type RoomParticipant = ReturnType<typeof useParticipants>[number];
type ChangeRole = (input: JoinInput) => Promise<string | undefined>;

// LiveKit fills in the local participant's identity, name, and grants after
// the first render without re-rendering, so the viewer's own details come from
// the backend's join result instead.
function isViewer(participant: RoomParticipant, viewer: JoinResult) {
  return (
    participant.isLocal || participant.identity === viewer.participantIdentity
  );
}

function publishes(participant: RoomParticipant, viewer: JoinResult) {
  return isViewer(participant, viewer)
    ? viewer.role === "debater"
    : participant.permissions?.canPublish === true;
}

function displayNameOf(participant: RoomParticipant, viewer: JoinResult) {
  return (
    participant.name ||
    (isViewer(participant, viewer) ? viewer.displayName : undefined)
  );
}

function sideOf(participant: RoomParticipant, viewer: JoinResult) {
  return isViewer(participant, viewer)
    ? String(viewer.sideIndex)
    : participant.attributes[SIDE_ATTRIBUTE];
}

/** Places each publishing participant on the side issued in their token. */
function assignDebaters(participants: RoomParticipant[], viewer: JoinResult) {
  const debaters = participants
    .filter((participant) => publishes(participant, viewer))
    .slice(0, 2);
  const debatersBySide = new Map<number, RoomParticipant>();
  const unassigned = [];

  for (const participant of debaters) {
    const side = sideOf(participant, viewer);
    if ((side === "0" || side === "1") && !debatersBySide.has(Number(side))) {
      debatersBySide.set(Number(side), participant);
    } else {
      unassigned.push(participant);
    }
  }

  for (const participant of unassigned) {
    const openSide = [0, 1].find((side) => !debatersBySide.has(side));
    if (openSide !== undefined) debatersBySide.set(openSide, participant);
  }

  return debatersBySide;
}

function DebateVideos({ join }: { join: JoinResult }) {
  const { sides } = join;
  const participants = useParticipants();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const debatersBySide = assignDebaters(participants, join);

  return (
    <section className="grid min-h-0 grid-cols-2 bg-background">
      {sides.map((side, slot) => {
        const participant = debatersBySide.get(slot);
        const track = cameraTracks.find(
          (candidate) =>
            candidate.participant.identity === participant?.identity,
        );
        const label = participant && displayNameOf(participant, join);

        return (
          <article
            className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]"
            key={side}
          >
            <header
              className={
                "px-3 py-2 text-center " +
                (slot === 0 ? "bg-emerald-50/80" : "bg-red-50/70")
              }
            >
              <h2
                className={
                  "font-editorial text-base font-semibold sm:text-lg " +
                  (slot === 0 ? "text-emerald-900" : "text-red-900")
                }
              >
                {side}
              </h2>
            </header>
            <figure className="relative m-0 min-h-0 overflow-hidden bg-neutral-950 text-white">
              {label ? (
                <figcaption className="absolute top-3 left-3 z-10">
                  <Badge
                    className={
                      slot === 0
                        ? "bg-emerald-50/80 text-emerald-900"
                        : "bg-red-50/70 text-red-900"
                    }
                  >
                    {label}
                  </Badge>
                </figcaption>
              ) : null}
              <div className="flex size-full items-center justify-center">
                {track ? (
                  <VideoTrack
                    trackRef={track}
                    style={{
                      height: "100%",
                      objectFit: "cover",
                      transform: "scaleX(-1)",
                      transformOrigin: "center",
                      width: "100%",
                    }}
                  />
                ) : (
                  <p className="px-3 text-center text-sm text-neutral-300">
                    {participant ? "Camera unavailable" : "Side available"}
                  </p>
                )}
              </div>
            </figure>
          </article>
        );
      })}
    </section>
  );
}

function RoomChat({
  canSend,
  participantIdentity,
}: {
  canSend: boolean;
  participantIdentity: string;
}) {
  const { chatMessages, isSending, send } = useChat();
  const room = useRoomContext();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [hasDisplayName, setHasDisplayName] = useState(false);
  const [isNaming, setIsNaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!canSend || !value) return;

    setError(undefined);
    try {
      if (!hasDisplayName) {
        setIsNaming(true);
        await room.localParticipant.setName(value);
        setHasDisplayName(true);
      } else {
        await send(value);
      }
      setDraft("");
      requestAnimationFrame(() => input.current?.focus());
    } catch {
      setError(
        hasDisplayName
          ? "Message could not be sent."
          : "Display name could not be saved.",
      );
    } finally {
      setIsNaming(false);
    }
  }

  return (
    <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] bg-background">
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 p-4">
              {chatMessages.length === 0 ? (
                <p className="my-auto text-center text-sm text-muted-foreground">
                  {canSend
                    ? "No messages yet. Start the conversation."
                    : "No spectator messages yet."}
                </p>
              ) : (
                chatMessages.map((message) => {
                  const name = message.from?.name || "Participant";
                  const isOwnMessage =
                    message.from?.identity === participantIdentity;
                  const sentAt = new Date(message.timestamp);

                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                    >
                      <Message align={isOwnMessage ? "end" : "start"}>
                        <MessageContent>
                          <MessageHeader className="gap-2">
                            <span className="truncate">{name}</span>
                            <time
                              className="shrink-0 font-normal"
                              dateTime={sentAt.toISOString()}
                            >
                              {chatTimeFormatter.format(sentAt)}
                            </time>
                          </MessageHeader>
                          <Bubble
                            variant={isOwnMessage ? "default" : "secondary"}
                          >
                            <BubbleContent>{message.message}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  );
                })
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {canSend ? (
        <form
          className="grid gap-2 bg-muted/40 p-3"
          onSubmit={(event) => void submit(event)}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <label className="sr-only" htmlFor="room-chat-input">
            {hasDisplayName ? "Message" : "Display name"}
          </label>
          <div className="flex items-center gap-2">
            {hasDisplayName ? (
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      aria-label="Add emoji"
                      size="icon"
                      type="button"
                      variant="outline"
                    />
                  }
                >
                  <SmileIcon />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-fit p-0" side="top">
                  <EmojiPicker
                    className="h-80"
                    onEmojiSelect={({ emoji }) => {
                      setDraft((current) => current + emoji);
                      setEmojiOpen(false);
                      requestAnimationFrame(() => input.current?.focus());
                    }}
                  >
                    <EmojiPickerSearch />
                    <EmojiPickerContent />
                    <EmojiPickerFooter />
                  </EmojiPicker>
                </PopoverContent>
              </Popover>
            ) : null}
            <Input
              autoComplete={hasDisplayName ? "off" : "nickname"}
              id="room-chat-input"
              maxLength={hasDisplayName ? 500 : 40}
              name={hasDisplayName ? "message" : "displayName"}
              placeholder={
                hasDisplayName ? "Message the room" : "Choose a display name"
              }
              ref={input}
              required
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              aria-label={hasDisplayName ? "Send message" : undefined}
              disabled={isSending || isNaming || draft.trim().length === 0}
              size={hasDisplayName ? "icon" : "default"}
              type="submit"
            >
              {hasDisplayName ? <SendIcon /> : "Continue"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ParticipantRoster({
  join,
  onChangeRole,
}: {
  join: JoinResult;
  onChangeRole: ChangeRole;
}) {
  const participants = useParticipants();
  const debatersBySide = assignDebaters(participants, join);
  const spectators = participants.filter(
    (participant) => !publishes(participant, join),
  );
  const viewerIsDebater = join.role === "debater";
  const viewer = participants.find((participant) =>
    isViewer(participant, join),
  );
  const viewerName = (viewer && displayNameOf(viewer, join)) ?? "";
  const [claimedSide, setClaimedSide] = useState<0 | 1>();
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string>();

  function nameOf(participant: RoomParticipant) {
    const name =
      displayNameOf(participant, join) ||
      (publishes(participant, join) ? "Debater" : "Spectator");
    return isViewer(participant, join) ? `${name} (you)` : name;
  }

  async function changeRole(input: JoinInput) {
    setChanging(true);
    setError(undefined);
    try {
      const message = await onChangeRole(input);
      if (message) setError(message);
    } catch {
      setError("Your role could not be changed. Try again.");
    } finally {
      setChanging(false);
      setClaimedSide(undefined);
    }
  }

  function claimSide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (claimedSide === undefined) return;
    const displayName = new FormData(event.currentTarget).get("displayName");
    if (typeof displayName !== "string" || !displayName.trim()) return;
    void changeRole({
      displayName: displayName.trim(),
      intent: "debater",
      sideIndex: claimedSide,
    });
  }

  return (
    <section
      aria-label="Participants"
      className="grid gap-3 bg-primary/5 px-4 py-3"
    >
      <div className="grid grid-cols-2 gap-6">
        <section aria-labelledby="debaters-heading" className="min-w-0">
          <h2
            className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
            id="debaters-heading"
          >
            Debaters{" "}
            <span className="tabular-nums">{debatersBySide.size} of 2</span>
          </h2>
          <ul className="mt-2 grid gap-1.5">
            {join.sides.map((side, index) => {
              const sideIndex = index === 0 ? 0 : 1;
              const participant = debatersBySide.get(sideIndex);
              const isOwnSide =
                participant !== undefined && isViewer(participant, join);

              return (
                <li
                  className={
                    "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 " +
                    sideTints[sideIndex]
                  }
                  key={side}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {participant ? nameOf(participant) : "Open"}
                    </p>
                    <p className="truncate text-xs opacity-80">{side}</p>
                  </div>
                  {!participant && !viewerIsDebater ? (
                    <Button
                      disabled={changing}
                      size="xs"
                      type="button"
                      onClick={() => setClaimedSide(sideIndex)}
                    >
                      Debate<span className="sr-only">: {side}</span>
                    </Button>
                  ) : null}
                  {isOwnSide ? (
                    <Button
                      disabled={changing}
                      size="xs"
                      type="button"
                      variant="outline"
                      onClick={() => void changeRole({ intent: "spectator" })}
                    >
                      Spectate
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="spectators-heading" className="min-w-0">
          <h2
            className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
            id="spectators-heading"
          >
            Spectators <span className="tabular-nums">{spectators.length}</span>
          </h2>
          {spectators.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No spectators yet.
            </p>
          ) : (
            <ul className="mt-2 grid max-h-24 gap-1 overflow-y-auto text-sm">
              {spectators.map((participant) => (
                <li className="truncate" key={participant.identity}>
                  {nameOf(participant)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Dialog
        open={claimedSide !== undefined}
        onOpenChange={(open) => {
          if (!open) setClaimedSide(undefined);
        }}
      >
        <DialogContent>
          {claimedSide !== undefined ? (
            <form className="grid gap-4" onSubmit={claimSide}>
              <DialogHeader>
                <DialogTitle className="font-editorial text-xl">
                  Debate this topic
                </DialogTitle>
                <DialogDescription>{join.topicTitle}</DialogDescription>
              </DialogHeader>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Your position
                </p>
                <p className="font-medium">{join.sides[claimedSide]}</p>
              </div>
              <div>
                <label className="sr-only" htmlFor="room-display-name">
                  Display name
                </label>
                <Input
                  autoComplete="nickname"
                  defaultValue={
                    viewerName && viewerName !== "Spectator"
                      ? viewerName
                      : undefined
                  }
                  id="room-display-name"
                  maxLength={40}
                  name="displayName"
                  pattern=".*\S.*"
                  placeholder="Display name"
                  required
                  title="Enter a display name."
                />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setClaimedSide(undefined)}
                >
                  Cancel
                </Button>
                <Button disabled={changing} type="submit">
                  Debate
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AudiencePanel({
  canVote,
  join,
  onChangeRole,
}: {
  canVote: boolean;
  join: JoinResult;
  onChangeRole: ChangeRole;
}) {
  const { participantIdentity, sides } = join;
  const participants = useParticipants();
  const room = useRoomContext();
  const [isVoting, setIsVoting] = useState(false);
  const [error, setError] = useState<string>();
  const spectators = participants.filter(
    (participant) => !publishes(participant, join),
  );
  const rawVote = room.localParticipant.attributes[VOTE_ATTRIBUTE];
  const selectedVote =
    canVote && (rawVote === "0" || rawVote === "1") ? rawVote : undefined;
  const voteCounts = sides.map(
    (_, index) =>
      spectators.filter(
        (participant) =>
          participant.attributes[VOTE_ATTRIBUTE] === String(index),
      ).length,
  );
  const voteTotal = voteCounts.reduce((total, count) => total + count, 0);

  async function vote(value: readonly string[]) {
    if (!canVote) return;
    const choice = value[0] ?? "";

    setError(undefined);
    setIsVoting(true);
    try {
      await room.localParticipant.setAttributes({
        [VOTE_ATTRIBUTE]: choice,
      });
    } catch {
      setError("Your vote could not be recorded.");
    } finally {
      setIsVoting(false);
    }
  }

  return (
    <aside className="flex min-h-0 flex-col bg-background">
      <ParticipantRoster join={join} onChangeRole={onChangeRole} />

      <section className="grid gap-3 px-4 pt-5 pb-4">
        <div>
          <h2 className="font-editorial text-lg font-semibold">
            Audience vote
          </h2>
          <p className="text-sm text-muted-foreground">
            {canVote
              ? "Vote for the debater who presented the stronger argument. Tap again to undo."
              : "Audience votes appear here as spectators choose the stronger argument."}
          </p>
        </div>
        {canVote ? (
          <ToggleGroup
            className="flex w-full gap-2"
            disabled={isVoting}
            value={selectedVote ? [selectedVote] : []}
            onValueChange={(value) => void vote(value)}
          >
            {sides.map((side, index) => (
              <ToggleGroupItem
                className={voteSurface + " " + voteSurfaceColors[index]}
                key={side}
                style={{ flexGrow: (voteCounts[index] ?? 0) + 1 }}
                value={String(index)}
              >
                <span className="min-w-0 leading-tight">{side}</span>
                <span className="shrink-0 tabular-nums">
                  {voteCounts[index]}{" "}
                  {voteCounts[index] === 1 ? "vote" : "votes"}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <dl
            className="flex w-full gap-2 text-sm"
            title="Only spectators can vote."
          >
            {sides.map((side, index) => (
              <div
                className={voteSurface + " " + voteSurfaceColors[index]}
                key={side}
                style={{ flexGrow: (voteCounts[index] ?? 0) + 1 }}
              >
                <dt className="min-w-0 leading-tight">{side}</dt>
                <dd className="shrink-0 font-medium tabular-nums">
                  {voteCounts[index]}{" "}
                  {voteCounts[index] === 1 ? "vote" : "votes"}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">
          {voteTotal}
          {voteTotal === 1 ? " spectator vote" : " spectator votes"}
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>
      <RoomChat canSend={canVote} participantIdentity={participantIdentity} />
    </aside>
  );
}

function LeaveButton({
  join,
  leaving,
  onLeaving,
}: {
  join: JoinResult;
  leaving: boolean;
  onLeaving: () => void;
}) {
  const room = useRoomContext();
  const navigate = useNavigate();

  async function leave() {
    onLeaving();
    await room.disconnect();
    await leaveTopic(join.topicId, join.participantIdentity);
    await navigate("/");
  }

  return (
    <Button
      aria-label={leaving ? "Leaving debate" : "Leave debate"}
      className="size-12"
      disabled={leaving}
      size="icon-lg"
      type="button"
      variant="destructive"
      onClick={() => void leave()}
    >
      <LogOutIcon className="size-5" />
    </Button>
  );
}

function MediaPermissionGuard({
  failed,
  join,
}: {
  failed: boolean;
  join: JoinResult;
}) {
  const room = useRoomContext();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (!failed || handled.current) return;
    handled.current = true;

    void (async () => {
      await room.disconnect();
      await leaveTopic(join.topicId, join.participantIdentity).catch(() => {});
      await navigate("/", {
        replace: true,
        state: { mediaPermissionFailure: true },
      });
    })();
  }, [failed, join.participantIdentity, join.topicId, navigate, room]);

  return null;
}

export function DebateExperience({ join: initialJoin }: { join: JoinResult }) {
  const [join, setJoin] = useState(initialJoin);
  const [roomError, setRoomError] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const [mediaPermissionFailed, setMediaPermissionFailed] = useState(false);
  const isDebater = join.role === "debater";

  // A role change is a fresh join: the backend re-checks availability and
  // issues a token with the new grants, then the previous identity leaves.
  async function changeRole(input: JoinInput) {
    const result = await joinTopic(join.topicId, input);
    if ("code" in result) return result.message;

    const previous = join;
    setRoomError(undefined);
    setJoin(result);
    void leaveTopic(previous.topicId, previous.participantIdentity).catch(
      () => {},
    );
    return undefined;
  }

  return (
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-muted/30">
      <LiveKitRoom
        key={join.participantIdentity}
        audio={isDebater}
        connect={!leaving}
        serverUrl={join.livekitUrl}
        style={{ display: "contents" }}
        token={join.token}
        video={isDebater ? VIDEO_CAPTURE_720P : false}
        onError={(error) => setRoomError(error.message)}
        onMediaDeviceFailure={() => {
          if (!isDebater) return;
          setLeaving(true);
          setMediaPermissionFailed(true);
        }}
      >
        <MediaPermissionGuard failed={mediaPermissionFailed} join={join} />
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-[#fbfcfe] px-4 py-2">
          <div className="min-w-0">
            <p className="font-editorial text-base font-semibold text-primary">
              {PRODUCT.name}
            </p>
            <h1 className="font-editorial truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {join.topicTitle}
            </h1>
          </div>
          <LeaveButton
            join={join}
            leaving={leaving}
            onLeaving={() => setLeaving(true)}
          />
          {roomError ? (
            <Alert className="col-span-full" variant="destructive">
              <AlertDescription>{roomError}</AlertDescription>
            </Alert>
          ) : null}
        </header>

        <div className="grid min-h-0 grid-rows-[minmax(12rem,36svh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:grid-rows-1">
          <DebateVideos join={join} />
          <AudiencePanel
            canVote={!isDebater}
            join={join}
            onChangeRole={changeRole}
          />
          <RoomAudioRenderer />
        </div>
      </LiveKitRoom>
    </main>
  );
}

export default function Debate() {
  const result = useActionData<typeof clientAction>();
  if (!result) return <Navigate to="/" replace />;

  if ("code" in result) {
    return (
      <main className="mx-auto grid max-w-xl gap-6 p-6 sm:py-12">
        <header>
          <h1 className="text-2xl font-semibold">Side unavailable</h1>
          <p className="text-sm text-muted-foreground">{result.topicTitle}</p>
        </header>
        <Alert variant="destructive">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link className={buttonVariants({ variant: "outline" })} to="/">
            Choose another side
          </Link>
          <Form method="post">
            <input name="intent" type="hidden" value="spectator" />
            <Button type="submit">Spectate debate</Button>
          </Form>
        </div>
      </main>
    );
  }

  return <DebateExperience join={result} key={result.participantIdentity} />;
}
