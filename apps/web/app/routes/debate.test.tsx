// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  JoinResult,
  SideUnavailableError,
} from "@impromptu/api/contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CSSProperties, ReactNode } from "react";
import {
  MemoryRouter,
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

type MockParticipant = {
  attributes: Record<string, string>;
  identity: string;
  isLocal?: boolean;
  name: string;
  permissions: { canPublish: boolean };
};

const defaultParticipants: MockParticipant[] = [
  {
    attributes: { "debate.vote": "0" },
    identity: "spectator-id",
    name: "Test spectator",
    permissions: { canPublish: false },
  },
  {
    attributes: { "debate.side": "0" },
    identity: "debater-id",
    name: "Debater guest",
    permissions: { canPublish: true },
  },
];

const {
  disconnectRoom,
  joinRoom,
  leaveRoom,
  roomState,
  getParticipants,
  sendChat,
  startDebateRequest,
  endRoundRequest,
  submitVoteRequest,
  setAttributes,
  setName,
} = vi.hoisted(() => ({
  submitVoteRequest: vi.fn<typeof import("../api").submitVote>(),
  endRoundRequest: vi.fn<typeof import("../api").endRound>(),
  disconnectRoom: vi.fn<() => Promise<void>>(),
  joinRoom:
    vi.fn<
      (
        topicId: string,
        input: unknown,
      ) => Promise<JoinResult | SideUnavailableError>
    >(),
  roomState: {
    participants: [] as MockParticipant[],
    connection: "connected",
    metadataListeners: new Set<(metadata: string) => void>(),
  },
  getParticipants: vi.fn<typeof import("../api").getRoomParticipants>(),
  leaveRoom:
    vi.fn<
      (topicId: string, lobbyId: string, token: string) => Promise<unknown>
    >(),
  sendChat: vi.fn<(message: string) => Promise<unknown>>(),
  startDebateRequest:
    vi.fn<
      (
        topicId: string,
        input: { lobbyId: string; token: string },
      ) => Promise<{ state: JoinResult["state"] }>
    >(),
  setAttributes: vi.fn<(attributes: Record<string, string>) => Promise<void>>(),
  setName: vi.fn<(name: string) => Promise<void>>(),
}));

beforeEach(() => {
  submitVoteRequest.mockImplementation(async (_, input) => ({
    votingEndsAt: new Date(Date.now() + 30000).toISOString(),
    voteCounts: input.choice === "1" ? [0, 1] : [0, 0],
    selectedVote: input.choice,
  }));
  roomState.participants = defaultParticipants;
  roomState.connection = "connected";
  roomState.metadataListeners.clear();
  getParticipants.mockResolvedValue({
    hostIdentity: null,
    state: "WAITING",
    votingEndsAt: new Date(Date.now() + 30000).toISOString(),
    voteCounts: [1, 0],
    selectedVote: "0",
    participants: [],
  });
  sessionStorage.clear();
});

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  joinTopic: joinRoom,
  leaveTopic: leaveRoom,
  startDebate: startDebateRequest,
  endRound: endRoundRequest,
  submitVote: submitVoteRequest,
  getRoomParticipants: getParticipants,
}));

vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({
    audio,
    children,
    connect,
    onMediaDeviceFailure,
    token,
    video,
  }: {
    audio: boolean;
    children: ReactNode;
    connect: boolean;
    onMediaDeviceFailure?: () => void;
    token: string;
    video: boolean | { resolution: { height: number; width: number } };
  }) => (
    <div
      data-testid="livekit-room"
      data-audio={audio}
      data-connect={connect}
      data-token={token}
      data-video={Boolean(video)}
      data-video-height={
        typeof video === "object" ? video.resolution.height : undefined
      }
      data-video-width={
        typeof video === "object" ? video.resolution.width : undefined
      }
    >
      {children}
      <button type="button" onClick={onMediaDeviceFailure}>
        Simulate media failure
      </button>
    </div>
  ),
  RoomAudioRenderer: () => null,
  VideoTrack: ({ style }: { style?: CSSProperties }) => (
    <div data-testid="video-track" style={style} />
  ),
  useChat: () => ({
    chatMessages: [
      {
        from: { identity: "another-id", name: "Another guest" },
        id: "message-1",
        message: "Hello room",
        timestamp: 1,
      },
    ],
    isSending: false,
    send: sendChat,
  }),
  useParticipants: () => roomState.participants,
  useConnectionState: () => roomState.connection,
  useRoomContext: () => ({
    disconnect: disconnectRoom,
    localParticipant: {
      attributes: { "debate.vote": "0" },
      setAttributes,
      setName,
    },
    on: (event: string, listener: (metadata: string) => void) => {
      if (event === "roomMetadataChanged") {
        roomState.metadataListeners.add(listener);
      }
    },
    off: (event: string, listener: (metadata: string) => void) => {
      if (event === "roomMetadataChanged") {
        roomState.metadataListeners.delete(listener);
      }
    },
  }),
  useTracks: () => [
    {
      participant: { identity: "debater-id" },
    },
  ],
}));

import Debate, {
  clientAction,
  DebateExperience,
  RoundCountdown,
} from "./debate";
import { recalledRoom, rememberRoom, roomPreferences } from "../room-session";

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}</output>;
}

describe("DebateExperience", () => {
  it("redirects to the home page when joining a missing private lobby", async () => {
    joinRoom.mockRejectedValueOnce(
      new ApiError("Private lobby not found", 404),
    );
    const formData = new FormData();
    formData.set("intent", "spectator");
    const router = createMemoryRouter(
      [
        {
          path: "/debates/:topicId",
          action: (args) =>
            clientAction({
              ...args,
              serverAction: async () => {
                throw new Error("The server action should not be called.");
              },
            }),
          element: <LocationProbe />,
        },
        { path: "/", element: <LocationProbe /> },
      ],
      { initialEntries: ["/debates/dream-cheating"] },
    );
    render(<RouterProvider router={router} />);

    await router.navigate("/debates/dream-cheating", {
      formData,
      formMethod: "post",
    });
    expect(await screen.findByText("/")).toBeVisible();
  });

  it("returns home with a reason when a selected public side becomes unavailable", async () => {
    joinRoom.mockResolvedValueOnce({
      code: "SIDE_UNAVAILABLE",
      message:
        "That side was just taken. Choose another side or spectate instead.",
      sideIndex: 0,
      topicTitle: "Can you cheat in a dream?",
    });
    const router = createMemoryRouter(
      [
        {
          path: "/debates/:topicId",
          action: (args) =>
            clientAction({
              ...args,
              serverAction: async () => {
                throw new Error("The server action should not be called.");
              },
            }),
          element: <LocationProbe />,
        },
        { path: "/", element: <LocationProbe /> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    const formData = new FormData();
    formData.set("intent", "debater");
    formData.set("displayName", "Late guest");
    formData.set("sideIndex", "0");
    await router.navigate("/debates/dream-cheating", {
      formData,
      formMethod: "post",
    });
    expect(await screen.findByText("/")).toBeVisible();
    expect(router.state.location.search).toContain("lobbyError=");
    expect(
      new URLSearchParams(router.state.location.search).get("lobbyError"),
    ).toBe(
      "That side was just taken. Choose another side or spectate instead.",
    );
  });

  it("connects spectators without publishing media and lets them vote and chat", async () => {
    sendChat.mockResolvedValue({});
    setAttributes.mockResolvedValue();
    setName.mockResolvedValue();
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test spectator",
      role: "spectator",
      sideIndex: null,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "spectator-token",
    };

    render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );

    const room = screen.getByTestId("livekit-room");
    const voteTab = screen.getByRole("tab", { name: "Vote" });
    const participantsTab = screen.getByRole("tab", {
      name: /Participants/,
    });
    expect(voteTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Participants" })).toBeNull();
    fireEvent.keyDown(voteTab, { key: "ArrowRight" });
    expect(participantsTab).toHaveAttribute("aria-selected", "true");
    expect(participantsTab).toHaveFocus();
    const participantRoster = screen.getByRole("region", {
      name: "Participants",
    });
    expect(within(participantRoster).getByText("Test spectator")).toBeVisible();
    expect(participantRoster).toHaveTextContent("Debater guest");
    expect(
      screen.getByRole("heading", { name: "Debaters 1 of 2" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Spectators 1" })).toBeVisible();
    expect(room).toHaveAttribute("data-audio", "false");
    expect(room).toHaveAttribute("data-video", "false");
    expect(screen.queryByText("Open position")).not.toBeInTheDocument();
    expect(screen.getByTestId("video-track")).toHaveStyle({
      transform: "scaleX(-1)",
    });
    const firstSide = screen
      .getByRole("heading", { name: "Yes: intention still matters" })
      .closest("article");
    expect(firstSide).not.toBeNull();
    expect(within(firstSide!).getByText("Debater guest")).toHaveClass(
      "bg-emerald-50/80",
    );
    expect(within(firstSide!).getByTestId("video-track")).toBeVisible();
    fireEvent.click(voteTab);
    expect(screen.getByText(/Hello room/)).toBeVisible();
    const messageTime = document.querySelector("time");
    expect(messageTime).toHaveAttribute("datetime", new Date(1).toISOString());
    expect(messageTime).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(1)),
    );
    await act(async () => {});
    expect(
      screen.queryByRole("button", { name: /Yes: intention still matters.*1/ }),
    ).toBeNull();
    act(() => {
      for (const listener of roomState.metadataListeners) listener("VOTING");
    });
    const sidesFilled = screen.getByText("Sides filled").closest("div");
    const spectatorCount = screen.getByText("Spectators").closest("div");
    expect(within(sidesFilled!).getByText("1 of 2")).toBeVisible();
    expect(within(spectatorCount!).getByText("1")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /Yes: intention still matters.*1/,
      }),
    ).toBePressed();
    expect(
      screen.getByRole("button", {
        name: /Yes: intention still matters.*1/,
      }),
    ).toHaveStyle({ flexGrow: "2" });
    expect(
      screen.getByRole("button", { name: /No: dreams are involuntary.*0/ }),
    ).toHaveStyle({ flexGrow: "1" });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Yes: intention still matters.*1/,
      }),
    );
    await waitFor(() =>
      expect(submitVoteRequest).toHaveBeenCalledWith(join.topicId, {
        lobbyId: join.lobbyId,
        token: join.token,
        choice: null,
      }),
    );
    setAttributes.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: /No: dreams are involuntary.*0/ }),
    );
    await waitFor(() =>
      expect(submitVoteRequest).toHaveBeenCalledWith(join.topicId, {
        lobbyId: join.lobbyId,
        token: join.token,
        choice: "1",
      }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "  Hello back  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith("Hello back"));
  });

  it("asks a spectator for a name before chat and restores their name and vote", async () => {
    sendChat.mockResolvedValue({});
    setName.mockResolvedValue();
    setAttributes.mockResolvedValue();
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "spectator-id",
      displayName: "Spectator",
      role: "spectator",
      sideIndex: null,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "spectator-token",
    };
    const view = render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("textbox", { name: "Display name" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(setName).toHaveBeenCalledWith("Ada"));
    expect(sendChat).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(sendChat).toHaveBeenCalledWith("Hello"));
    act(() => {
      for (const listener of roomState.metadataListeners) listener("VOTING");
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /No: dreams are involuntary.*0/,
      }),
    );
    await waitFor(() =>
      expect(roomPreferences(join.topicId)).toEqual({
        displayName: "Ada",
      }),
    );
    view.unmount();
    setName.mockClear();
    setAttributes.mockClear();
    render(
      <MemoryRouter>
        <DebateExperience
          join={{ ...join, state: "VOTING", voteEligible: true }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toBeVisible();
    await waitFor(() => expect(setName).toHaveBeenCalledWith("Ada"));
    expect(setAttributes).not.toHaveBeenCalled();
  });

  it("does not let a debater vote or send chat messages", async () => {
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test debater",
      role: "debater",
      sideIndex: 0,
      isCreator: true,
      hostIdentity: "debater-id",
      joinCode: "ABCD23",
      livekitUrl: "ws://localhost:7880",
      token: "debater-token",
    };

    render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));

    const room = screen.getByTestId("livekit-room");
    expect(room).toHaveAttribute("data-video", "true");
    expect(room).toHaveAttribute("data-video-width", "1280");
    expect(room).toHaveAttribute("data-video-height", "720");
    fireEvent.click(screen.getByRole("tab", { name: /Participants/ }));
    expect(
      within(screen.getByRole("region", { name: "Participants" })).getByText(
        "Debater guest",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Vote" }));
    const readOnlyVote = screen.getByTitle("Only spectators can vote.");
    expect(readOnlyVote).toBeVisible();
    expect(
      screen.getByText(
        "Audience votes appear here as spectators choose the stronger argument.",
      ),
    ).toBeVisible();
    expect(await screen.findByText("1 spectator vote")).toBeVisible();
    expect(
      within(readOnlyVote)
        .getByText("Yes: intention still matters")
        .closest("div"),
    ).toHaveStyle({ flexGrow: "2" });
    expect(
      screen.queryByRole("button", { name: /Yes: intention still matters/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Audience chat")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(setAttributes).not.toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("keeps the private lobby code visible after copying it", async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test debater",
      role: "debater",
      sideIndex: 0,
      isCreator: true,
      hostIdentity: "debater-id",
      joinCode: "ABCD23",
      livekitUrl: "ws://localhost:7880",
      token: "debater-token",
    };

    render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));

    const copyButton = screen.getByRole("button", {
      name: "Copy lobby code ABCD23",
    });
    expect(copyButton).toHaveTextContent("ABCD23");
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ABCD23"));
    expect(copyButton).toHaveTextContent("Copied");
    expect(copyButton).toHaveTextContent("ABCD23");
  });

  it("returns to selection after leaving the lobby successfully", async () => {
    disconnectRoom.mockResolvedValue();
    leaveRoom.mockResolvedValue({ status: "ok" });
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test spectator",
      role: "spectator",
      sideIndex: null,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "spectator-token",
    };

    render(
      <MemoryRouter initialEntries={["/debates/dream-cheating"]}>
        <DebateExperience join={join} />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave lobby" }));

    await waitFor(() => expect(screen.getByText("/")).toBeVisible());
    expect(recalledRoom("dream-cheating")).toBeUndefined();
    expect(leaveRoom).toHaveBeenCalledWith(
      join.topicId,
      join.lobbyId,
      join.token,
    );
    expect(disconnectRoom).toHaveBeenCalledOnce();
  });

  it("shows an error and permits retry when releasing a disconnected room fails", async () => {
    leaveRoom.mockRejectedValue(new Error("Leave request failed"));
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test spectator",
      role: "spectator",
      sideIndex: null,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "spectator-token",
    };

    render(
      <MemoryRouter initialEntries={["/debates/dream-cheating"]}>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave lobby" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Leave request failed",
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-connect",
      "true",
    );
    expect(screen.getByRole("button", { name: "Leave lobby" })).toBeEnabled();
    expect(disconnectRoom).toHaveBeenCalledOnce();
  });

  it("disconnects a debater whose camera or microphone cannot start", async () => {
    disconnectRoom.mockResolvedValue();
    leaveRoom.mockResolvedValue({ left: true });
    const join: JoinResult = {
      lobbyId: "dream-cheating",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test debater",
      role: "debater",
      sideIndex: 0,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "debater-token",
    };

    render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Simulate media failure" }),
    );

    await waitFor(() => expect(disconnectRoom).toHaveBeenCalledOnce());
    expect(leaveRoom).toHaveBeenCalledWith(
      join.topicId,
      join.lobbyId,
      join.token,
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-connect",
      "false",
    );
  });
});

describe("Round countdown", () => {
  it("counts down from the server deadline, catches up after delays, and stops at zero", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-29T12:00:00Z");
    vi.setSystemTime(now);
    const view = render(
      <RoundCountdown endsAt={new Date(now.getTime() + 65000).toISOString()} />,
    );
    expect(
      screen.getByRole("timer", { name: "Round time remaining" }),
    ).toHaveTextContent("1:05");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("1:04");
    act(() => {
      vi.setSystemTime(new Date(now.getTime() + 63000));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("0:01");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Participant roster", () => {
  const spectatorJoin: JoinResult = {
    lobbyId: "dream-cheating",
    state: "WAITING",
    topicId: "dream-cheating",
    topicTitle: "Can you cheat in a dream?",
    sides: ["Yes: intention still matters", "No: dreams are involuntary"],
    participantIdentity: "spectator-id",
    displayName: "Spectator",
    role: "spectator",
    sideIndex: null,
    isCreator: false,
    hostIdentity: null,
    livekitUrl: "ws://localhost:7880",
    token: "spectator-token",
  };
  const debaterJoin: JoinResult = {
    ...spectatorJoin,
    participantIdentity: "new-debater-id",
    displayName: "Test spectator",
    role: "debater",
    sideIndex: 1,
    token: "debater-token",
  };

  it("requires creator setup before connecting and keeps the timer choice for starting", async () => {
    const creator = {
      ...spectatorJoin,
      isCreator: true,
      hostIdentity: spectatorJoin.participantIdentity,
    };
    roomState.participants = [
      ...defaultParticipants,
      {
        attributes: { "debate.side": "1" },
        identity: "second-debater",
        name: "Second",
        permissions: { canPublish: true },
      },
    ];
    startDebateRequest.mockResolvedValue({ state: "DEBATE_IN_PROGRESS" });
    render(
      <MemoryRouter>
        <DebateExperience join={creator} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("dialog", { name: "How should this round end?" }),
    ).toBeVisible();
    expect(screen.queryByTestId("livekit-room")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start Debate" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "End round by" }), {
      target: { value: "timer" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Round duration in minutes" }),
      { target: { value: "10" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("livekit-room")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start Debate" }));
    await waitFor(() =>
      expect(startDebateRequest).toHaveBeenCalledWith(creator.topicId, {
        lobbyId: creator.lobbyId,
        token: creator.token,
        durationSeconds: 600,
      }),
    );
  });

  it("ends a manual round once and shows submission feedback", async () => {
    const creator = {
      ...spectatorJoin,
      state: "DEBATE_IN_PROGRESS" as const,
      hostIdentity: spectatorJoin.participantIdentity,
    };
    getParticipants.mockResolvedValue({
      hostIdentity: creator.hostIdentity,
      state: creator.state,
      roundEndsAt: null,
      participants: [],
    });
    let finish!: (value: { state: "VOTING" }) => void;
    endRoundRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MemoryRouter>
        <DebateExperience join={creator} />
      </MemoryRouter>,
    );
    const button = await screen.findByRole("button", { name: "End round" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(
      screen.getByRole("button", { name: "Ending round…" }),
    ).toBeDisabled();
    expect(endRoundRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ state: "VOTING" });
    });
    expect(screen.getByText("Audience voting is open")).toBeVisible();
    expect(screen.queryByRole("button", { name: "End round" })).toBeNull();
  });

  it.each([true, false])(
    "hides manual ending for timed rounds and non-creators (%s)",
    async (timed) => {
      getParticipants.mockResolvedValue({
        hostIdentity: timed ? spectatorJoin.participantIdentity : "other-host",
        state: "DEBATE_IN_PROGRESS",
        roundEndsAt: timed ? new Date(Date.now() + 60000).toISOString() : null,
        participants: [],
      });
      render(
        <MemoryRouter>
          <DebateExperience
            join={{ ...spectatorJoin, state: "DEBATE_IN_PROGRESS" }}
          />
        </MemoryRouter>,
      );
      await waitFor(() => expect(getParticipants).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "End round" })).toBeNull();
    },
  );

  it("shows the waiting message beside the topic only while the lobby is waiting", () => {
    const { unmount } = render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Waiting for others to join...")).toBeVisible();

    unmount();
    render(
      <MemoryRouter>
        <DebateExperience
          join={{ ...spectatorJoin, state: "DEBATE_IN_PROGRESS" }}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("Waiting for others to join..."),
    ).not.toBeInTheDocument();
  });

  it("shows the creator's start button after round setup and enables it only when ready", async () => {
    const creator: JoinResult = {
      ...spectatorJoin,
      lobbyId: "private-lobby",
      participantIdentity: "creator-id",
      displayName: "Creator",
      role: "debater",
      sideIndex: 0,
      isCreator: true,
      hostIdentity: "creator-id",
    };
    roomState.participants = [
      {
        attributes: { "debate.side": "0" },
        identity: creator.participantIdentity,
        isLocal: true,
        name: creator.displayName,
        permissions: { canPublish: true },
      },
      {
        attributes: { "debate.side": "1" },
        identity: "other-debater",
        name: "Other debater",
        permissions: { canPublish: true },
      },
    ];
    startDebateRequest.mockResolvedValue({ state: "DEBATE_IN_PROGRESS" });
    const view = render(
      <MemoryRouter>
        <DebateExperience join={creator} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));

    const start = screen.getByRole("button", { name: "Start Debate" });
    expect(start).toBeDisabled();
    expect(
      screen.queryByText("Waiting for others to join..."),
    ).not.toBeInTheDocument();

    roomState.participants = [
      ...roomState.participants,
      {
        attributes: {},
        identity: "spectator-guest",
        name: "Spectator guest",
        permissions: { canPublish: false },
      },
    ];
    view.rerender(
      <MemoryRouter>
        <DebateExperience join={creator} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Start Debate" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Start Debate" }));
    expect(await screen.findByText("Debate in progress ...")).toBeVisible();
    expect(startDebateRequest).toHaveBeenCalledWith(creator.topicId, {
      lobbyId: creator.lobbyId,
      token: creator.token,
    });
  });

  it("updates every participant's lobby status from room metadata", () => {
    render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Waiting for others to join...")).toBeVisible();

    act(() => {
      for (const listener of roomState.metadataListeners) {
        listener("DEBATE_IN_PROGRESS");
      }
    });

    expect(screen.getByText("Debate in progress ...")).toBeVisible();
    expect(
      screen.queryByText("Waiting for others to join..."),
    ).not.toBeInTheDocument();
  });

  it("moves connected participants to voting and ignores duplicate phase events", async () => {
    getParticipants.mockResolvedValue({
      hostIdentity: null,
      state: "DEBATE_IN_PROGRESS",
      participants: [],
    });
    render(
      <MemoryRouter>
        <DebateExperience
          join={{ ...spectatorJoin, state: "DEBATE_IN_PROGRESS" }}
        />
        <DebateExperience
          join={{ ...debaterJoin, state: "DEBATE_IN_PROGRESS" }}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getParticipants).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Debate in progress ...")).toHaveLength(2);
    const attributeWrites = setAttributes.mock.calls.length;
    for (let delivery = 0; delivery < 2; delivery++) {
      act(() => {
        for (const listener of roomState.metadataListeners) listener("VOTING");
      });
      expect(screen.getAllByText("Audience voting is open")).toHaveLength(2);
      expect(
        screen.queryByText("Debate in progress ..."),
      ).not.toBeInTheDocument();
    }
    expect(setAttributes).toHaveBeenCalledTimes(attributeWrites);
  });

  it("shows an accessible voting indicator but no voting controls for late spectators", () => {
    render(
      <MemoryRouter>
        <DebateExperience
          join={{ ...spectatorJoin, state: "VOTING", voteEligible: false }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Voting is in progress",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(
      screen.queryByRole("button", { name: /Yes: intention still matters/ }),
    ).toBeNull();
    expect(
      screen.getByTitle("You are not eligible to vote this round."),
    ).toBeVisible();
  });

  it("disables votes at the deadline even while the phase is still VOTING", async () => {
    vi.useFakeTimers();
    const endsAt = new Date(Date.now() + 30_000).toISOString();
    getParticipants.mockResolvedValue({
      state: "VOTING",
      hostIdentity: null,
      participants: [],
      votingEndsAt: endsAt,
      voteCounts: [1, 0],
      selectedVote: "0",
    });
    render(
      <MemoryRouter>
        <DebateExperience
          join={{ ...spectatorJoin, state: "VOTING", voteEligible: true }}
        />
      </MemoryRouter>,
    );
    await act(async () => {});
    const choice = screen.getByRole("button", {
      name: /No: dreams are involuntary/,
    });
    expect(choice).toBeEnabled();
    expect(
      screen.getByRole("timer", { name: "Voting time remaining" }),
    ).toHaveTextContent("0:30");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      screen.getByRole("timer", { name: "Voting time remaining" }),
    ).toHaveTextContent("0:20");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getAllByText("Voting is closed")).toHaveLength(2);
    expect(
      screen.queryByRole("timer", { name: "Voting time remaining" }),
    ).toBeNull();
    expect(choice).toBeDisabled();
    fireEvent.click(choice);
    expect(submitVoteRequest).not.toHaveBeenCalled();
    expect(screen.getByText("1 spectator vote")).toBeVisible();
  });

  it.each(["accepted", "rejected", "network failure"])(
    "shows pending feedback then handles a vote that is %s",
    async (outcome) => {
      getParticipants.mockResolvedValue({
        state: "VOTING",
        hostIdentity: null,
        participants: [],
        votingEndsAt: new Date(Date.now() + 30_000).toISOString(),
        voteCounts: [0, 0],
        selectedVote: null,
      });
      let resolve!: (
        value: Awaited<ReturnType<typeof import("../api").submitVote>>,
      ) => void;
      let reject!: (error: Error) => void;
      submitVoteRequest.mockImplementationOnce(
        () =>
          new Promise((accept, fail) => {
            resolve = accept;
            reject = fail;
          }),
      );
      render(
        <MemoryRouter>
          <DebateExperience
            join={{ ...spectatorJoin, state: "VOTING", voteEligible: true }}
          />
        </MemoryRouter>,
      );
      await act(async () => {});
      const choice = screen.getByRole("button", {
        name: /No: dreams are involuntary/,
      });
      fireEvent.click(choice);
      expect(screen.getByText("Submitting vote…")).toBeVisible();
      expect(choice).toBeDisabled();
      fireEvent.click(choice);
      expect(submitVoteRequest).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (outcome === "accepted")
          resolve({
            votingEndsAt: new Date(Date.now() + 30_000).toISOString(),
            voteCounts: [0, 1],
            selectedVote: "1",
          });
        else
          reject(
            outcome === "rejected"
              ? new ApiError("Voting is closed", 409)
              : new TypeError("Failed to fetch"),
          );
      });
      expect(screen.queryByText("Your vote was received.") !== null).toBe(
        outcome === "accepted",
      );
      expect(
        screen.queryByText("Your vote could not be recorded.") !== null,
      ).toBe(outcome !== "accepted");
    },
  );

  it("loads the current voting phase after reconnecting with stale debate state", async () => {
    const join = { ...spectatorJoin, state: "DEBATE_IN_PROGRESS" as const };
    getParticipants.mockResolvedValue({
      hostIdentity: null,
      state: "DEBATE_IN_PROGRESS",
      participants: [],
    });
    const view = render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getParticipants).toHaveBeenCalledTimes(1));
    roomState.connection = "reconnecting";
    view.rerender(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getParticipants).toHaveBeenCalledTimes(2));
    getParticipants.mockResolvedValue({
      hostIdentity: null,
      state: "VOTING",
      participants: [],
    });
    roomState.connection = "connected";
    view.rerender(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Audience voting is open")).toBeVisible();
    expect(
      screen.queryByText("Debate in progress ..."),
    ).not.toBeInTheDocument();
  });

  it("shows the public start button to the current host and waiting text to other participants", () => {
    const publicHost: JoinResult = {
      ...spectatorJoin,
      participantIdentity: "public-host",
      hostIdentity: "public-host",
      isCreator: true,
    };
    const { unmount } = render(
      <MemoryRouter>
        <DebateExperience join={publicHost} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));
    expect(screen.getByRole("button", { name: "Start Debate" })).toBeDisabled();

    unmount();
    const guest: JoinResult = {
      ...spectatorJoin,
      hostIdentity: "public-host",
    };
    render(
      <MemoryRouter>
        <DebateExperience join={guest} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Start Debate" })).toBeNull();
    expect(screen.getByText("Waiting for others to join...")).toBeVisible();
  });

  function roster() {
    if (!screen.queryByRole("region", { name: "Participants" })) {
      fireEvent.click(screen.getByRole("tab", { name: /Participants/ }));
    }
    const participants = screen.getByRole("region", { name: "Participants" });
    return {
      debaters: within(participants).getByRole("region", {
        name: /^Debaters/,
      }),
      spectators: within(participants).getByRole("region", {
        name: /^Spectators/,
      }),
    };
  }

  it("restores the creator's code and current host role after a page reload", () => {
    const restored: JoinResult = {
      ...debaterJoin,
      participantIdentity: "1f0c6b57-bfed-4768-9b30-419d326f90fa",
      isCreator: true,
      hostIdentity: "1f0c6b57-bfed-4768-9b30-419d326f90fa",
      joinCode: "ABCD2345",
    };
    roomState.participants = [
      {
        ...defaultParticipants[0]!,
        identity: restored.participantIdentity,
        isLocal: true,
      },
    ];
    rememberRoom(restored);
    const router = createMemoryRouter(
      [{ path: "/debates/:topicId", element: <Debate /> }],
      { initialEntries: ["/debates/dream-cheating"] },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));
    expect(
      screen.getByRole("button", { name: "Copy lobby code ABCD2345" }),
    ).toBeVisible();
    expect(within(roster().debaters).getByText("Host")).toBeVisible();
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-token",
      "debater-token",
    );
  });

  it("shows a recoverable participant retrieval error without disabling the room", async () => {
    getParticipants.mockRejectedValueOnce(new Error("Unavailable"));
    render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Participants could not be loaded",
    );
    expect(screen.getByRole("button", { name: "Leave lobby" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Display name" })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry participant list" }),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a closed-lobby popup and returns home when its button is clicked", async () => {
    getParticipants.mockRejectedValueOnce(
      new ApiError("Private lobby not found", 404),
    );
    const router = createMemoryRouter(
      [
        {
          path: "/debates/:topicId",
          element: <DebateExperience join={spectatorJoin} />,
        },
        { path: "/", element: <LocationProbe /> },
      ],
      { initialEntries: ["/debates/dream-cheating"] },
    );
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { name: "The lobby was closed" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/debates/dream-cheating");
    expect(recalledRoom("dream-cheating")).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Go to home" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText("/")).toBeVisible();
  });

  it("deduplicates joins and rebuilds membership after leaves and reconnects", async () => {
    roomState.participants = [...defaultParticipants, defaultParticipants[1]!];
    const view = render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );
    expect(
      within(roster().debaters).getAllByRole("listitem")[0],
    ).toHaveTextContent("Debater guest");
    expect(
      screen.getByRole("heading", { name: "Debaters 1 of 2" }),
    ).toBeVisible();
    await waitFor(() => expect(getParticipants).toHaveBeenCalledTimes(1));
    roomState.connection = "reconnecting";
    roomState.participants = [defaultParticipants[0]!];
    view.rerender(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );
    expect(within(roster().debaters).queryByText("Debater guest")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Debaters 0 of 2" }),
    ).toBeVisible();
    roomState.connection = "connected";
    roomState.participants = [...defaultParticipants];
    view.rerender(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );
    expect(within(roster().debaters).getByText("Debater guest")).toBeVisible();
    await waitFor(() =>
      expect(getParticipants.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("displays a sole participant and marks the host before LiveKit fills their identity", () => {
    roomState.participants = [
      {
        attributes: {},
        identity: "",
        isLocal: true,
        name: "",
        permissions: { canPublish: false },
      },
    ];
    render(
      <MemoryRouter>
        <DebateExperience
          join={{
            ...spectatorJoin,
            hostIdentity: spectatorJoin.participantIdentity,
            isCreator: true,
          }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));
    const rows = within(roster().spectators).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Spectator (you)Host");
  });

  it("groups debaters by position and spectators separately", () => {
    roomState.participants = [
      ...defaultParticipants,
      {
        attributes: {},
        identity: "another-spectator",
        name: "Spectator",
        permissions: { canPublish: false },
      },
    ];

    render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );

    const { debaters, spectators } = roster();
    const debaterRows = within(debaters).getAllByRole("listitem");
    expect(debaterRows).toHaveLength(2);
    expect(debaterRows[0]).toHaveTextContent(
      "Debater guestYes: intention still matters",
    );
    expect(debaterRows[0]).toHaveClass("bg-emerald-50");
    expect(debaterRows[1]).toHaveTextContent("OpenNo: dreams are involuntary");
    expect(debaterRows[1]).toHaveClass("bg-red-50");
    expect(
      within(spectators)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Test spectator (you)", "Spectator"]);
    expect(within(spectators).queryByText("Debater guest")).toBeNull();
    expect(screen.getByRole("heading", { name: "Spectators 2" })).toBeVisible();
  });

  it("labels the host in either group and puts a spectator host first", () => {
    roomState.participants = [
      ...defaultParticipants,
      {
        attributes: {},
        identity: "host-id",
        name: "Host guest",
        permissions: { canPublish: false },
      },
    ];
    const view = render(
      <MemoryRouter>
        <DebateExperience
          join={{ ...spectatorJoin, hostIdentity: "host-id" }}
        />
      </MemoryRouter>,
    );
    const rows = within(roster().spectators).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Host guestHost");
    expect(within(rows[0]!).getByText("Host")).toBeVisible();
    view.unmount();
    render(
      <MemoryRouter>
        <DebateExperience
          join={{
            ...spectatorJoin,
            hostIdentity:
              defaultParticipants.find(
                (participant) => participant.permissions?.canPublish,
              )?.identity ?? null,
          }}
        />
      </MemoryRouter>,
    );
    expect(within(roster().debaters).getByText("Host")).toBeVisible();
  });

  it("moves another participant between groups when their role changes", () => {
    const guest: MockParticipant = {
      attributes: {},
      identity: "guest-id",
      name: "Grace",
      permissions: { canPublish: false },
    };
    roomState.participants = [...defaultParticipants, guest];
    const view = render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );
    expect(within(roster().spectators).getByText("Grace")).toBeVisible();

    roomState.participants = [
      ...defaultParticipants,
      {
        ...guest,
        attributes: { "debate.side": "1" },
        permissions: { canPublish: true },
      },
    ];
    view.rerender(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );

    const { debaters, spectators } = roster();
    expect(within(debaters).getAllByRole("listitem")[1]).toHaveTextContent(
      "GraceNo: dreams are involuntary",
    );
    expect(within(spectators).queryByText("Grace")).toBeNull();
    expect(
      within(spectators)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Test spectator (you)"]);
    expect(
      screen.getByRole("heading", { name: "Debaters 2 of 2" }),
    ).toBeVisible();
  });

  it("identifies the viewer before LiveKit reports their details", () => {
    roomState.participants = [
      {
        attributes: {},
        identity: "",
        isLocal: true,
        name: "",
        permissions: { canPublish: false },
      },
    ];

    render(
      <MemoryRouter>
        <DebateExperience join={debaterJoin} />
      </MemoryRouter>,
    );

    const { debaters, spectators } = roster();
    expect(within(debaters).getAllByRole("listitem")[1]).toHaveTextContent(
      "Test spectator (you)No: dreams are involuntary",
    );
    expect(within(spectators).getByText("No spectators yet.")).toBeVisible();
  });

  it("lets a spectator take an open side through the backend", async () => {
    joinRoom.mockResolvedValue(debaterJoin);
    leaveRoom.mockResolvedValue({ status: "ok" });

    render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );

    expect(
      within(roster().debaters).getAllByRole("button", { name: /^Debate/ }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Debate: No: dreams are involuntary",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("No: dreams are involuntary"),
    ).toBeVisible();
    const displayName = within(dialog).getByPlaceholderText("Display name");
    expect(displayName).toHaveValue("Test spectator");
    fireEvent.click(within(dialog).getByRole("button", { name: "Debate" }));

    await waitFor(() =>
      expect(screen.getByTestId("livekit-room")).toHaveAttribute(
        "data-token",
        "debater-token",
      ),
    );
    expect(screen.getByRole("tab", { name: /Participants/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(joinRoom).toHaveBeenCalledWith("dream-cheating", {
      displayName: "Test spectator",
      intent: "debater",
      lobbyId: "dream-cheating",
      previousToken: "spectator-token",
      sideIndex: 1,
    });
    expect(leaveRoom).toHaveBeenCalledWith(
      "dream-cheating",
      "dream-cheating",
      "spectator-token",
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-video",
      "true",
    );
  });

  it("keeps a spectator in place with a clear message when the side is gone", async () => {
    joinRoom.mockResolvedValue({
      code: "SIDE_UNAVAILABLE",
      message:
        "That side was just taken. Choose another side or spectate instead.",
      sideIndex: 1,
      topicTitle: "Can you cheat in a dream?",
    });

    render(
      <MemoryRouter>
        <DebateExperience join={spectatorJoin} />
      </MemoryRouter>,
    );

    fireEvent.click(
      within(roster().debaters).getByRole("button", {
        name: "Debate: No: dreams are involuntary",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Debate",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That side was just taken. Choose another side or spectate instead.",
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-token",
      "spectator-token",
    );
    expect(leaveRoom).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a debater give up their side to spectate", async () => {
    roomState.participants = [
      {
        attributes: { "debate.side": "1" },
        identity: "new-debater-id",
        name: "Test spectator",
        permissions: { canPublish: true },
      },
    ];
    joinRoom.mockResolvedValue({ ...spectatorJoin, token: "rejoined-token" });
    leaveRoom.mockResolvedValue({ status: "ok" });

    render(
      <MemoryRouter>
        <DebateExperience join={debaterJoin} />
      </MemoryRouter>,
    );

    expect(
      within(roster().debaters).queryByRole("button", { name: /^Debate/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Spectate" }));

    await waitFor(() =>
      expect(screen.getByTestId("livekit-room")).toHaveAttribute(
        "data-token",
        "rejoined-token",
      ),
    );
    expect(joinRoom).toHaveBeenCalledWith("dream-cheating", {
      intent: "spectator",
      lobbyId: "dream-cheating",
      previousToken: "debater-token",
    });
    expect(leaveRoom).toHaveBeenCalledWith(
      "dream-cheating",
      "dream-cheating",
      "debater-token",
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-video",
      "false",
    );
  });

  it("keeps the host badge and avoids removing the preserved identity after switching", async () => {
    const privateJoin = {
      ...spectatorJoin,
      hostIdentity: spectatorJoin.participantIdentity,
      isCreator: true,
      joinCode: "ABCD2345",
    };
    joinRoom.mockResolvedValue({
      ...privateJoin,
      role: "debater",
      sideIndex: 1,
      token: "changed-token",
    });
    getParticipants.mockResolvedValue({
      hostIdentity: privateJoin.participantIdentity,
      state: "WAITING",
      participants: [],
    });
    render(
      <MemoryRouter>
        <DebateExperience join={privateJoin} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));
    fireEvent.click(
      within(roster().debaters).getByRole("button", {
        name: /Debate.*No: dreams are involuntary/,
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Debate",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("livekit-room")).toHaveAttribute(
        "data-token",
        "changed-token",
      ),
    );
    expect(within(roster().debaters).getByText("Host")).toBeVisible();
    expect(leaveRoom).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Copy lobby code ABCD2345" }),
    ).toBeVisible();
  });

  it("changes role inside a private lobby and keeps the creator's code", async () => {
    const privateJoin: JoinResult = {
      ...spectatorJoin,
      lobbyId: "private-lobby-id",
      isCreator: true,
      joinCode: "ABCD2345",
    };
    joinRoom.mockResolvedValue({
      ...debaterJoin,
      lobbyId: "private-lobby-id",
      isCreator: false,
    });
    leaveRoom.mockResolvedValue({ status: "ok" });

    render(
      <MemoryRouter>
        <DebateExperience join={privateJoin} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to lobby" }));

    fireEvent.click(
      within(roster().debaters).getByRole("button", {
        name: /Debate.*No: dreams are involuntary/,
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Debate",
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("livekit-room")).toHaveAttribute(
        "data-token",
        "debater-token",
      ),
    );
    expect(joinRoom).toHaveBeenCalledWith(
      "dream-cheating",
      expect.objectContaining({ lobbyId: "private-lobby-id" }),
    );
    expect(leaveRoom).toHaveBeenCalledWith(
      "dream-cheating",
      "private-lobby-id",
      "spectator-token",
    );
    expect(
      screen.getByRole("button", { name: "Copy lobby code ABCD2345" }),
    ).toBeVisible();
  });
});
