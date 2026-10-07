import {
  PRODUCT,
  joinBodySchema,
  joinResultSchema,
  type LobbyState,
  type JoinInput,
  type JoinResult,
} from "@impromptu/api/contracts";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useChat,
  useConnectionState,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { CopyIcon, LogOutIcon, SendIcon, SmileIcon } from "lucide-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ClientActionFunctionArgs,
  Form,
  Link,
  Navigate,
  useActionData,
  useLocation,
  useNavigate,
  useParams,
  redirect,
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

import {
  ApiError,
  closeLobby,
  getRoomParticipants,
  joinTopic,
  leaveTopic,
  startDebate as startDebateRequest,
} from "../api";
import {
  forgetRoom,
  recalledRoom,
  rememberRoom,
  roomPreferences,
  updateRoomPreferences,
} from "../room-session";

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
  try {
    return await joinTopic(params.topicId, input);
  } catch (cause) {
    if (isPrivateLobbyNotFound(cause)) return redirect("/");
    throw cause;
  }
}

function isPrivateLobbyNotFound(cause: unknown) {
  return (
    cause instanceof ApiError &&
    cause.status === 404 &&
    cause.message === "Private lobby not found"
  );
}

type RoomParticipant = ReturnType<typeof useParticipants>[number];
type ChangeRole = (input: JoinInput) => Promise<string | undefined>;

function useRoomParticipants(join: JoinResult) {
  const participants = useParticipants();
  return [
    ...new Map(
      participants.map((participant) => [
        participant.isLocal ? join.participantIdentity : participant.identity,
        participant,
      ]),
    ).values(),
  ];
}

function isHost(participant: RoomParticipant, join: JoinResult) {
  return (
    participant.identity === join.hostIdentity ||
    (isViewer(participant, join) &&
      join.participantIdentity === join.hostIdentity)
  );
}

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
  const participants = useRoomParticipants(join);
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
  initialDisplayName,
  participantIdentity,
  topicId,
}: {
  canSend: boolean;
  initialDisplayName?: string;
  participantIdentity: string;
  topicId: string;
}) {
  const { chatMessages, isSending, send } = useChat();
  const room = useRoomContext();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [hasDisplayName, setHasDisplayName] = useState(
    Boolean(initialDisplayName),
  );
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
        updateRoomPreferences(topicId, { displayName: value });
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

function ParticipantStatus({
  join,
  onPrivateLobbyNotFound,
  onStatus,
}: {
  join: JoinResult;
  onPrivateLobbyNotFound: (cause: unknown) => boolean;
  onStatus: (status: {
    hostIdentity: string | null;
    state: LobbyState;
  }) => void;
}) {
  const { topicId, lobbyId, token } = join;
  const connection = useConnectionState();
  const [error, setError] = useState<string>();
  const requestId = useRef(0);
  const refresh = useCallback(() => {
    const currentRequest = ++requestId.current;
    void getRoomParticipants({ topicId, lobbyId, token }).then(
      (status) => {
        if (currentRequest === requestId.current) {
          onStatus(status);
          setError(undefined);
        }
      },
      (cause: unknown) => {
        if (currentRequest !== requestId.current) return;
        if (onPrivateLobbyNotFound(cause)) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Participants could not be loaded. Try again.",
        );
      },
    );
  }, [lobbyId, onPrivateLobbyNotFound, onStatus, token, topicId]);
  useEffect(() => {
    if (connection === ConnectionState.Connected) refresh();
    return () => {
      requestId.current += 1;
    };
  }, [connection, refresh]);
  if (!error) return null;
  return (
    <Alert className="col-span-full" variant="destructive">
      <AlertDescription>{error}</AlertDescription>
      <Button type="button" variant="outline" size="sm" onClick={refresh}>
        Retry participant list
      </Button>
    </Alert>
  );
}

function LobbyStatus({
  join,
  onStart,
  onStateChange,
  starting,
}: {
  join: JoinResult;
  onStart: () => void;
  onStateChange: (state: LobbyState) => void;
  starting: boolean;
}) {
  const participants = useRoomParticipants(join);
  const room = useRoomContext();
  const debaterCount = assignDebaters(participants, join).size;
  const hasSpectator = participants.some(
    (participant) => !publishes(participant, join),
  );
  const isLobbyHost =
    join.hostIdentity === join.participantIdentity ||
    (join.isCreator && join.lobbyId !== join.topicId);

  useEffect(() => {
    function updateState(metadata: string) {
      if (metadata === "DEBATE_IN_PROGRESS") {
        onStateChange("DEBATE_IN_PROGRESS");
      }
    }
    room.on(RoomEvent.RoomMetadataChanged, updateState);
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, updateState);
    };
  }, [onStateChange, room]);

  if (join.state === "DEBATE_IN_PROGRESS") {
    return (
      <p className="shrink-0 text-sm text-muted-foreground">
        Debate in progress ...
      </p>
    );
  }

  if (join.state !== "WAITING") return null;
  if (!isLobbyHost) {
    return (
      <p className="shrink-0 text-sm text-muted-foreground">
        Waiting for others to join...
      </p>
    );
  }

  return (
    <Button
      className="shrink-0"
      disabled={starting || debaterCount !== 2 || !hasSpectator}
      type="button"
      onClick={onStart}
    >
      Start Debate
    </Button>
  );
}

function ParticipantRoster({
  join,
  onChangeRole,
  onPrivateLobbyNotFound,
}: {
  join: JoinResult;
  onChangeRole: ChangeRole;
  onPrivateLobbyNotFound: (cause: unknown) => boolean;
}) {
  const participants = useRoomParticipants(join);
  const debatersBySide = assignDebaters(participants, join);
  const spectators = participants.filter(
    (participant) => !publishes(participant, join),
  );
  spectators.sort(
    (first, second) =>
      Number(isHost(second, join)) - Number(isHost(first, join)),
  );
  const viewerIsDebater = join.role === "debater";
  const canChangeRole = join.state === "WAITING";
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
    if (!canChangeRole) return;
    setChanging(true);
    setError(undefined);
    try {
      const message = await onChangeRole(input);
      if (message) setError(message);
    } catch (cause) {
      if (onPrivateLobbyNotFound(cause)) return;
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Your role could not be changed. Try again.",
      );
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
    <section aria-label="Participants" className="grid gap-3">
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
                  {participant && isHost(participant, join) ? (
                    <Badge variant="secondary">Host</Badge>
                  ) : null}
                  {!participant && !viewerIsDebater && canChangeRole ? (
                    <Button
                      disabled={changing}
                      size="xs"
                      type="button"
                      onClick={() => setClaimedSide(sideIndex)}
                    >
                      Debate<span className="sr-only">: {side}</span>
                    </Button>
                  ) : null}
                  {isOwnSide && canChangeRole ? (
                    <Button
                      disabled={changing}
                      size="xs"
                      type="button"
                      variant="secondary"
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
                <li
                  className="flex min-w-0 items-center gap-2"
                  key={participant.identity}
                >
                  <span className="truncate">{nameOf(participant)}</span>
                  {isHost(participant, join) ? (
                    <Badge variant="secondary">Host</Badge>
                  ) : null}
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
        open={canChangeRole && claimedSide !== undefined}
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

type AudienceTab = "vote" | "participants";

function AudiencePanel({
  activeTab,
  canVote,
  join,
  onChangeRole,
  onPrivateLobbyNotFound,
  onTabChange: setActiveTab,
}: {
  activeTab: AudienceTab;
  canVote: boolean;
  join: JoinResult;
  onChangeRole: ChangeRole;
  onPrivateLobbyNotFound: (cause: unknown) => boolean;
  onTabChange: (tab: AudienceTab) => void;
}) {
  const { participantIdentity, sides } = join;
  const participants = useRoomParticipants(join);
  const room = useRoomContext();
  const [isVoting, setIsVoting] = useState(false);
  const [error, setError] = useState<string>();
  const debaterCount = assignDebaters(participants, join).size;
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
      updateRoomPreferences(join.topicId, {
        vote: choice === "0" || choice === "1" ? choice : undefined,
      });
    } catch {
      setError("Your vote could not be recorded.");
    } finally {
      setIsVoting(false);
    }
  }

  return (
    <aside className="flex min-h-0 flex-col bg-background">
      <section className="bg-primary/5 px-4 py-3">
        <dl className="grid grid-cols-2 gap-6">
          <div>
            <dt className="text-xs text-muted-foreground">Sides filled</dt>
            <dd className="font-editorial text-2xl font-semibold">
              {debaterCount} of 2
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Spectators</dt>
            <dd className="font-editorial text-2xl font-semibold">
              {spectators.length}
            </dd>
          </div>
        </dl>
      </section>

      <div
        aria-label="Audience views"
        className="grid shrink-0 grid-cols-2 border-b px-4"
        role="tablist"
      >
        <button
          aria-controls="audience-tab-panel"
          aria-selected={activeTab === "vote"}
          className={
            "border-b-2 px-3 py-2 text-sm font-medium " +
            (activeTab === "vote"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
          id="audience-vote-tab"
          role="tab"
          tabIndex={activeTab === "vote" ? 0 : -1}
          type="button"
          onClick={() => setActiveTab("vote")}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setActiveTab("participants");
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>("#audience-participants-tab")
                ?.focus();
            }
          }}
        >
          Vote
        </button>
        <button
          aria-controls="audience-tab-panel"
          aria-selected={activeTab === "participants"}
          className={
            "border-b-2 px-3 py-2 text-sm font-medium " +
            (activeTab === "participants"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
          id="audience-participants-tab"
          role="tab"
          tabIndex={activeTab === "participants" ? 0 : -1}
          type="button"
          onClick={() => setActiveTab("participants")}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setActiveTab("vote");
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>("#audience-vote-tab")
                ?.focus();
            }
          }}
        >
          Participants{" "}
          <span className="tabular-nums">{participants.length}</span>
        </button>
      </div>
      <div
        aria-labelledby={`audience-${activeTab}-tab`}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        id="audience-tab-panel"
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "participants" ? (
          <ParticipantRoster
            join={join}
            onChangeRole={onChangeRole}
            onPrivateLobbyNotFound={onPrivateLobbyNotFound}
          />
        ) : (
          <section className="grid gap-3">
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
        )}
      </div>
      <RoomChat
        canSend={canVote}
        initialDisplayName={
          roomPreferences(join.topicId).displayName ??
          (join.displayName === "Spectator" ? undefined : join.displayName)
        }
        participantIdentity={participantIdentity}
        topicId={join.topicId}
      />
    </aside>
  );
}

function LeaveButton({
  join,
  leaving,
  onLeaving,
  onError,
  onPrivateLobbyNotFound,
}: {
  join: JoinResult;
  leaving: boolean;
  onLeaving: (leaving: boolean) => void;
  onError: (message: string) => void;
  onPrivateLobbyNotFound: (cause: unknown) => boolean;
}) {
  const room = useRoomContext();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const isCreator = join.isCreator && join.lobbyId !== join.topicId;

  async function leave() {
    setSubmitting(true);
    onLeaving(true);
    try {
      await room.disconnect();
      if (isCreator) {
        await closeLobby(join.topicId, join.lobbyId, join.token);
      } else {
        await leaveTopic(join.topicId, join.lobbyId, join.token);
      }
      forgetRoom(join.topicId);
      await navigate("/");
    } catch (cause) {
      if (onPrivateLobbyNotFound(cause)) return;
      onLeaving(false);
      setSubmitting(false);
      onError(
        cause instanceof Error
          ? cause.message
          : isCreator
            ? "The lobby could not be closed."
            : "The lobby could not be left.",
      );
    }
  }

  return (
    <Button
      aria-label={
        leaving || submitting
          ? isCreator
            ? "Closing lobby"
            : "Leaving lobby"
          : isCreator
            ? "Close lobby"
            : "Leave lobby"
      }
      className={isCreator ? "whitespace-nowrap px-3" : "size-12"}
      disabled={leaving || submitting}
      size={isCreator ? undefined : "icon-lg"}
      type="button"
      variant={isCreator ? "secondary" : "destructive"}
      onClick={() => void leave()}
    >
      {isCreator ? "Close Lobby" : <LogOutIcon className="size-5" />}
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
    forgetRoom(join.topicId);

    void (async () => {
      await room.disconnect();
      await leaveTopic(join.topicId, join.lobbyId, join.token).catch(() => {});
      await navigate("/", {
        replace: true,
        state: { mediaPermissionFailure: true },
      });
    })();
  }, [failed, join.lobbyId, join.token, join.topicId, navigate, room]);

  return null;
}

function SessionRestorer({ join }: { join: JoinResult }) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const restored = useRef(false);

  useEffect(() => {
    if (connection !== ConnectionState.Connected || restored.current) return;
    restored.current = true;
    if (join.role !== "spectator") return;
    const preferences = roomPreferences(join.topicId);
    void (async () => {
      try {
        if (preferences.displayName) {
          await room.localParticipant.setName(preferences.displayName);
        }
        if (preferences.vote) {
          await room.localParticipant.setAttributes({
            [VOTE_ATTRIBUTE]: preferences.vote,
          });
        }
      } catch {
        // The spectator can enter their name or vote again.
      }
    })();
  }, [connection, join.role, join.topicId, room]);

  return null;
}

export function DebateExperience({ join: initialJoin }: { join: JoinResult }) {
  const [join, setJoin] = useState(initialJoin);
  const navigate = useNavigate();
  const [roomError, setRoomError] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) rememberRoom(join);
  }, [join, leaving]);
  const [privateLobbyClosed, setPrivateLobbyClosed] = useState(false);
  const [mediaPermissionFailed, setMediaPermissionFailed] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [startingDebate, setStartingDebate] = useState(false);
  // Kept outside the room, which remounts when a role change issues a new token.
  const [audienceTab, setAudienceTab] = useState<AudienceTab>("vote");
  const isDebater = join.role === "debater";
  const onPrivateLobbyNotFound = useCallback(
    (cause: unknown) => {
      if (!isPrivateLobbyNotFound(cause)) return false;
      forgetRoom(join.topicId);
      setLeaving(true);
      if (join.isCreator) {
        void navigate("/", { replace: true });
      } else {
        setPrivateLobbyClosed(true);
      }
      return true;
    },
    [join.isCreator, join.topicId, navigate],
  );
  const updateLobbyState = useCallback((state: LobbyState) => {
    setJoin((current) =>
      current.state === state ? current : { ...current, state },
    );
  }, []);
  const updateLobbyStatus = useCallback(
    (status: { hostIdentity: string | null; state: LobbyState }) => {
      setJoin((current) => ({
        ...current,
        hostIdentity: status.hostIdentity,
        state: status.state,
      }));
    },
    [],
  );

  async function startDebate() {
    setStartingDebate(true);
    setRoomError(undefined);
    try {
      const result = await startDebateRequest(join.topicId, {
        lobbyId: join.lobbyId,
        token: join.token,
      });
      updateLobbyState(result.state);
    } catch (cause) {
      if (onPrivateLobbyNotFound(cause)) return;
      setRoomError(
        cause instanceof ApiError
          ? cause.message
          : "The debate could not be started. Try again.",
      );
    } finally {
      setStartingDebate(false);
    }
  }

  // A role change is a fresh join in the same lobby: the backend re-checks
  // availability and verifies the old token to preserve the participant identity.
  // Reconnecting with new grants keeps the host recognizable to every viewer.
  async function changeRole(input: JoinInput) {
    const result = await joinTopic(join.topicId, {
      ...input,
      lobbyId: join.lobbyId,
      previousToken: join.token,
    });
    if ("code" in result) return result.message;

    const previous = join;
    setRoomError(undefined);
    if (result.role === "debater") {
      updateRoomPreferences(join.topicId, { vote: undefined });
    }
    setJoin({
      ...result,
      isCreator: previous.isCreator,
      joinCode: previous.joinCode,
    });
    if (previous.participantIdentity !== result.participantIdentity)
      void leaveTopic(previous.topicId, previous.lobbyId, previous.token).catch(
        () => {},
      );
    return undefined;
  }

  async function copyJoinCode() {
    if (!join.joinCode) return;
    try {
      await navigator.clipboard.writeText(join.joinCode);
      setCodeCopied(true);
    } catch {
      setRoomError("Private lobby code could not be copied.");
    }
  }

  return (
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-muted/30">
      <LiveKitRoom
        key={join.token}
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
        <SessionRestorer join={join} />
        <Dialog open={privateLobbyClosed}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>The lobby was closed</DialogTitle>
              <DialogDescription>
                This private lobby is no longer available.
              </DialogDescription>
            </DialogHeader>
            <Button
              type="button"
              onClick={() => void navigate("/", { replace: true })}
            >
              Go to home
            </Button>
          </DialogContent>
        </Dialog>
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-[#fbfcfe] px-4 py-2">
          <div className="min-w-0">
            <p className="font-editorial text-base font-semibold text-primary">
              {PRODUCT.name}
            </p>
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="font-editorial min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {join.topicTitle}
              </h1>
              <LobbyStatus
                join={join}
                onStart={() => void startDebate()}
                onStateChange={updateLobbyState}
                starting={startingDebate}
              />
            </div>
            {join.isCreator && join.joinCode ? (
              <Button
                aria-label={`Copy lobby code ${join.joinCode}`}
                className="mt-2 h-11 max-w-full justify-start px-3 text-base"
                type="button"
                variant="outline"
                onClick={() => void copyJoinCode()}
              >
                <CopyIcon aria-hidden="true" />
                <span>Lobby code</span>
                <code className="font-mono text-lg font-semibold">
                  {join.joinCode}
                </code>
                <span
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {codeCopied ? "Copied" : "Copy"}
                </span>
              </Button>
            ) : null}
          </div>
          <LeaveButton
            join={join}
            leaving={leaving}
            onLeaving={setLeaving}
            onError={setRoomError}
            onPrivateLobbyNotFound={onPrivateLobbyNotFound}
          />
          <ParticipantStatus
            join={join}
            onPrivateLobbyNotFound={onPrivateLobbyNotFound}
            onStatus={updateLobbyStatus}
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
            activeTab={audienceTab}
            canVote={!isDebater}
            onTabChange={setAudienceTab}
            join={join}
            onChangeRole={changeRole}
            onPrivateLobbyNotFound={onPrivateLobbyNotFound}
          />
          <RoomAudioRenderer />
        </div>
      </LiveKitRoom>
    </main>
  );
}

export default function Debate() {
  const actionResult = useActionData<typeof clientAction>();
  const { topicId } = useParams();
  const saved = topicId ? recalledRoom(topicId) : undefined;
  const location = useLocation();
  const handoff =
    typeof location.state === "object" &&
    location.state !== null &&
    "joinResult" in location.state
      ? joinResultSchema.safeParse(location.state.joinResult)
      : undefined;
  const incoming = handoff?.success ? handoff.data : actionResult;
  const result =
    saved &&
    (!incoming ||
      (!("code" in incoming) &&
        incoming.participantIdentity === saved.participantIdentity &&
        incoming.lobbyId === saved.lobbyId))
      ? saved
      : incoming;
  if (!result) return <Navigate to="/" replace />;

  if ("code" in result) {
    if (result.code === "ROUND_ALREADY_STARTED") {
      return (
        <main className="mx-auto grid max-w-xl gap-6 p-6 sm:py-12">
          <h1 className="text-2xl font-semibold">Debate already started</h1>
          <Alert variant="destructive">
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
          <Link className={buttonVariants({ variant: "secondary" })} to="/">
            Choose a topic
          </Link>
        </main>
      );
    }
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
          <Link className={buttonVariants({ variant: "secondary" })} to="/">
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
