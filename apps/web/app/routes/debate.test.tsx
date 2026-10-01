// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  JoinResult,
  SideUnavailableError,
} from "@impromptu/api/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CSSProperties, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
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
  sendChat,
  setAttributes,
  setName,
} = vi.hoisted(() => ({
  disconnectRoom: vi.fn<() => Promise<void>>(),
  joinRoom:
    vi.fn<
      (
        topicId: string,
        input: unknown,
      ) => Promise<JoinResult | SideUnavailableError>
    >(),
  roomState: { participants: [] as MockParticipant[] },
  leaveRoom:
    vi.fn<(topicId: string, participantIdentity: string) => Promise<unknown>>(),
  sendChat: vi.fn<(message: string) => Promise<unknown>>(),
  setAttributes: vi.fn<(attributes: Record<string, string>) => Promise<void>>(),
  setName: vi.fn<(name: string) => Promise<void>>(),
}));

beforeEach(() => {
  roomState.participants = defaultParticipants;
});

vi.mock("../api", () => ({
  joinTopic: joinRoom,
  leaveTopic: leaveRoom,
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
  useRoomContext: () => ({
    disconnect: disconnectRoom,
    localParticipant: {
      attributes: { "debate.vote": "0" },
      setAttributes,
      setName,
    },
  }),
  useTracks: () => [
    {
      participant: { identity: "debater-id" },
    },
  ],
}));

import { DebateExperience } from "./debate";

describe("DebateExperience", () => {
  it("connects spectators without publishing media and lets them vote and chat", async () => {
    sendChat.mockResolvedValue({});
    setAttributes.mockResolvedValue();
    setName.mockResolvedValue();
    const join: JoinResult = {
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test spectator",
      role: "spectator",
      sideIndex: null,
      livekitUrl: "ws://localhost:7880",
      token: "spectator-token",
    };

    render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );

    const room = screen.getByTestId("livekit-room");
    expect(screen.queryByText("Spectator", { exact: true })).toBeNull();
    expect(room).toHaveAttribute("data-audio", "false");
    expect(room).toHaveAttribute("data-video", "false");
    expect(screen.queryByText("Open position")).not.toBeInTheDocument();
    expect(
      within(
        screen
          .getByRole("heading", { name: "Yes: intention still matters" })
          .closest("article")!,
      ).getByText("Debater guest"),
    ).toHaveClass("bg-emerald-50/80");
    expect(screen.getByTestId("video-track")).toHaveStyle({
      transform: "scaleX(-1)",
    });
    const firstSide = screen
      .getByRole("heading", { name: "Yes: intention still matters" })
      .closest("article");
    expect(firstSide).not.toBeNull();
    expect(within(firstSide!).getByTestId("video-track")).toBeVisible();
    expect(screen.getByText(/Hello room/)).toBeVisible();
    const messageTime = document.querySelector("time");
    expect(messageTime).toHaveAttribute("datetime", new Date(1).toISOString());
    expect(messageTime).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(1)),
    );
    expect(
      screen.getByRole("heading", { name: "Debaters 1 of 2" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Spectators 1" })).toBeVisible();
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
      expect(setAttributes).toHaveBeenCalledWith({ "debate.vote": "" }),
    );
    setAttributes.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: /No: dreams are involuntary.*0/ }),
    );
    await waitFor(() =>
      expect(setAttributes).toHaveBeenCalledWith({ "debate.vote": "1" }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Chat guest" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(setName).toHaveBeenCalledWith("Chat guest"));

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "  Hello back  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith("Hello back"));
  });

  it("does not let a debater vote or send chat messages", () => {
    const join: JoinResult = {
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test debater",
      role: "debater",
      sideIndex: 0,
      livekitUrl: "ws://localhost:7880",
      token: "debater-token",
    };

    render(
      <MemoryRouter>
        <DebateExperience join={join} />
      </MemoryRouter>,
    );

    const room = screen.getByTestId("livekit-room");
    expect(room).toHaveAttribute("data-video", "true");
    expect(room).toHaveAttribute("data-video-width", "1280");
    expect(room).toHaveAttribute("data-video-height", "720");
    expect(screen.queryByText("Debater", { exact: true })).toBeNull();
    const readOnlyVote = screen.getByTitle("Only spectators can vote.");
    expect(readOnlyVote).toBeVisible();
    expect(
      screen.getByText(
        "Audience votes appear here as spectators choose the stronger argument.",
      ),
    ).toBeVisible();
    expect(screen.getByText("1 spectator vote")).toBeVisible();
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

  it("disconnects a debater whose camera or microphone cannot start", async () => {
    disconnectRoom.mockResolvedValue();
    leaveRoom.mockResolvedValue({ left: true });
    const join: JoinResult = {
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: intention still matters", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Test debater",
      role: "debater",
      sideIndex: 0,
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
      join.participantIdentity,
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-connect",
      "false",
    );
  });
});

describe("Participant roster", () => {
  const spectatorJoin: JoinResult = {
    topicId: "dream-cheating",
    topicTitle: "Can you cheat in a dream?",
    sides: ["Yes: intention still matters", "No: dreams are involuntary"],
    participantIdentity: "spectator-id",
    displayName: "Spectator",
    role: "spectator",
    sideIndex: null,
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

  function roster() {
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
    expect(joinRoom).toHaveBeenCalledWith("dream-cheating", {
      displayName: "Test spectator",
      intent: "debater",
      sideIndex: 1,
    });
    expect(leaveRoom).toHaveBeenCalledWith("dream-cheating", "spectator-id");
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
      screen.getByRole("button", {
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
    });
    expect(leaveRoom).toHaveBeenCalledWith("dream-cheating", "new-debater-id");
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-video",
      "false",
    );
  });
});
