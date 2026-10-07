// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { JoinResult } from "@impromptu/api/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CSSProperties, ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { disconnectRoom, leaveRoom, sendChat, setAttributes, setName } =
  vi.hoisted(() => ({
    disconnectRoom: vi.fn<() => Promise<void>>(),
    leaveRoom:
      vi.fn<
        (
          topicId: string,
          lobbyId: string,
          participantIdentity: string,
        ) => Promise<unknown>
      >(),
    sendChat: vi.fn<(message: string) => Promise<unknown>>(),
    setAttributes:
      vi.fn<(attributes: Record<string, string>) => Promise<void>>(),
    setName: vi.fn<(name: string) => Promise<void>>(),
  }));

vi.mock("../api", () => ({
  joinTopic: vi.fn<() => never>(),
  leaveTopic: leaveRoom,
}));

vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({
    audio,
    children,
    connect,
    onMediaDeviceFailure,
    video,
  }: {
    audio: boolean;
    children: ReactNode;
    connect: boolean;
    onMediaDeviceFailure?: () => void;
    video: boolean | { resolution: { height: number; width: number } };
  }) => (
    <div
      data-testid="livekit-room"
      data-audio={audio}
      data-connect={connect}
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
  useParticipants: () => [
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
  ],
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

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}</output>;
}

describe("DebateExperience", () => {
  it("connects spectators without publishing media and lets them vote and chat", async () => {
    sendChat.mockResolvedValue({});
    setAttributes.mockResolvedValue();
    setName.mockResolvedValue();
    const join: JoinResult = {
      lobbyId: "dream-cheating",
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
    const sidesFilled = screen.getByText("Sides filled").closest("div");
    const spectators = screen.getByText("Spectators").closest("div");
    expect(sidesFilled).not.toBeNull();
    expect(spectators).not.toBeNull();
    expect(within(sidesFilled!).getByText("1 of 2")).toBeVisible();
    expect(within(spectators!).getByText("1")).toBeVisible();
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
      lobbyId: "dream-cheating",
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

  it("keeps the private lobby code visible after copying it", async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const join: JoinResult = {
      lobbyId: "dream-cheating",
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
    expect(leaveRoom).toHaveBeenCalledWith(
      join.topicId,
      join.lobbyId,
      join.participantIdentity,
    );
    expect(disconnectRoom).toHaveBeenCalledOnce();
  });

  it("keeps the participant connected and displays an error when leaving fails", async () => {
    leaveRoom.mockRejectedValue(new Error("Leave request failed"));
    const join: JoinResult = {
      lobbyId: "dream-cheating",
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
    expect(disconnectRoom).not.toHaveBeenCalled();
  });

  it("disconnects a debater whose camera or microphone cannot start", async () => {
    disconnectRoom.mockResolvedValue();
    leaveRoom.mockResolvedValue({ left: true });
    const join: JoinResult = {
      lobbyId: "dream-cheating",
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
      join.participantIdentity,
    );
    expect(screen.getByTestId("livekit-room")).toHaveAttribute(
      "data-connect",
      "false",
    );
  });
});
