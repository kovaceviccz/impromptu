// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  JoinByCodeInput,
  JoinResult,
  LobbyCreateInput,
  PrivateLobbyPreview,
  SideUnavailableError,
  TopicStatus,
} from "@impromptu/api/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createLobbyMock, joinTopicByCodeMock, lookupPrivateLobbyMock } =
  vi.hoisted(() => ({
    createLobbyMock: vi.fn<(input: LobbyCreateInput) => Promise<JoinResult>>(),
    joinTopicByCodeMock:
      vi.fn<
        (input: JoinByCodeInput) => Promise<JoinResult | SideUnavailableError>
      >(),
    lookupPrivateLobbyMock:
      vi.fn<(code: string) => Promise<PrivateLobbyPreview>>(),
  }));

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  createLobby: createLobbyMock,
  joinTopicByCode: joinTopicByCodeMock,
  lookupPrivateLobby: lookupPrivateLobbyMock,
}));

import Home, { MEDIA_PERMISSION_MESSAGE, TopicList } from "./home";

afterEach(cleanup);

describe("TopicList", () => {
  it("makes role intent explicit before joining and browses one topic at a time", async () => {
    const spectate =
      vi.fn<(input: Record<string, FormDataEntryValue>) => void>();
    const topics: TopicStatus[] = [
      {
        id: "dream-cheating",
        title: "Can you cheat in a dream?",
        sides: ["Yes: intention still matters", "No: dreams are involuntary"],
        sideAvailability: [true, false],
        debaterCount: 1,
        spectatorCount: 3,
        participants: [
          { displayName: "Alan", role: "debater", sideIndex: 1 },
          { displayName: "Spectator", role: "spectator", sideIndex: null },
        ],
      },
      {
        id: "moral-lying",
        title: "Is lying ever moral?",
        sides: ["Yes: context matters", "No: lying is always wrong"],
        sideAvailability: [false, false],
        debaterCount: 2,
        spectatorCount: 1,
        participants: [],
      },
    ];
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <TopicList defaultDisplayName="ada_lovelace" topics={topics} />
        ),
      },
      {
        path: "/debates/:topicId",
        action: async ({ request }) => {
          spectate(Object.fromEntries(await request.formData()));
          return null;
        },
        element: null,
      },
    ]);

    render(<RouterProvider router={router} />);

    expect(screen.getByText("Can you cheat in a dream?")).toBeVisible();
    expect(screen.queryByText("Is lying ever moral?")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeVisible();

    const dreamTopic = screen
      .getByText("Can you cheat in a dream?")
      .closest<HTMLDivElement>('[data-slot="card"]');
    expect(dreamTopic).not.toBeNull();

    expect(within(dreamTopic!).getByText("One side open")).toBeVisible();
    expect(within(dreamTopic!).getByText("3 people watching")).toBeVisible();
    expect(
      within(dreamTopic!).getByText("Yes: intention still matters"),
    ).toBeVisible();
    expect(
      within(dreamTopic!).getByRole("button", {
        name: /Side taken.*No: dreams are involuntary/,
      }),
    ).toBeDisabled();
    expect(within(dreamTopic!).getByText("Alan is debating")).toBeVisible();
    expect(
      within(dreamTopic!).queryByText("Spectator is debating"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(dreamTopic!).getByRole("button", {
        name: /Debate.*Yes: intention still matters/,
      }),
    );

    const debaterDialog = screen.getByRole("dialog");
    expect(within(debaterDialog).getByText("Debate this topic")).toBeVisible();
    expect(within(debaterDialog).getByText("Your position")).toBeVisible();
    expect(
      within(debaterDialog).getByPlaceholderText("Display name"),
    ).toBeRequired();
    expect(
      within(debaterDialog).getByPlaceholderText("Display name"),
    ).toHaveValue("ada_lovelace");
    fireEvent.click(
      within(debaterDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next topic" }));
    expect(screen.getByText("2 of 2")).toBeVisible();
    const lyingTopic = screen
      .getByText("Is lying ever moral?")
      .closest<HTMLDivElement>('[data-slot="card"]');
    expect(lyingTopic).not.toBeNull();
    const takenSideButtons = within(lyingTopic!).getAllByRole("button", {
      name: /Side taken:/,
    });
    expect(takenSideButtons).toHaveLength(2);
    for (const button of takenSideButtons) expect(button).toBeDisabled();

    fireEvent.click(
      within(lyingTopic!).getByRole("button", { name: "Watch live" }),
    );
    await waitFor(() =>
      expect(spectate).toHaveBeenCalledWith({ intent: "spectator" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains why a debater was returned home", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          loader: () => ({ account: null, topics: [] }),
          element: <Home />,
        },
      ],
      {
        initialEntries: [
          { pathname: "/", state: { mediaPermissionFailure: true } },
        ],
      },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      MEDIA_PERMISSION_MESSAGE,
    );
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent(
      MEDIA_PERMISSION_MESSAGE,
    );
  });

  it("shows account links that reflect the session", async () => {
    const account = {
      id: "0f7f2c2e-9d1b-4d3c-8f33-5b6f0d8f5a10",
      displayName: "Ada Lovelace",
      username: "ada_lovelace",
      email: "ada@example.com",
      createdAt: "2026-09-01T12:00:00.000Z",
    };
    const guestRouter = createMemoryRouter([
      {
        path: "/",
        loader: () => ({ account: null, topics: [] }),
        element: <Home />,
      },
    ]);
    render(<RouterProvider router={guestRouter} />);

    const guestNav = await screen.findByRole("navigation", { name: "Account" });
    expect(
      within(guestNav).getByRole("link", { name: "Log in" }),
    ).toHaveAttribute("href", "/login");
    expect(
      within(guestNav).getByRole("link", { name: "Register" }),
    ).toHaveAttribute("href", "/register");
    cleanup();

    const memberRouter = createMemoryRouter([
      { path: "/", loader: () => ({ account, topics: [] }), element: <Home /> },
    ]);
    render(<RouterProvider router={memberRouter} />);

    const memberNav = await screen.findByRole("navigation", {
      name: "Account",
    });
    expect(
      within(memberNav).getByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", "/account");
    expect(
      within(memberNav).queryByRole("link", { name: "Log in" }),
    ).toBeNull();
  });

  it("creates a private lobby and automatically joins the creator", async () => {
    createLobbyMock.mockResolvedValue({
      lobbyId: "private-lobby-id",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes", "No"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Sam",
      role: "debater",
      sideIndex: 0,
      isCreator: true,
      hostIdentity: "debater-id",
      joinCode: "ABCD23",
      livekitUrl: "ws://localhost:7880",
      token: "private-creator-token",
    });
    const topics: TopicStatus[] = [
      {
        id: "dream-cheating",
        title: "Can you cheat in a dream?",
        sides: ["Yes", "No"],
        sideAvailability: [true, true],
        debaterCount: 0,
        spectatorCount: 0,
        participants: [],
      },
    ];
    const router = createMemoryRouter(
      [
        { path: "/", element: <TopicList topics={topics} /> },
        {
          path: "/debates/:topicId",
          element: <p>Connected to private lobby</p>,
        },
      ],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Create or join a topic" }),
    );
    fireEvent.change(screen.getByLabelText("Topic question"), {
      target: { value: "Dream debate" },
    });
    fireEvent.change(screen.getByLabelText("Affirmative position"), {
      target: { value: "Yes: dreams are vivid" },
    });
    fireEvent.change(screen.getByLabelText("Opposing position"), {
      target: { value: "No: dreams are involuntary" },
    });
    fireEvent.change(screen.getByLabelText("Creator display name"), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and join" }));

    expect(await screen.findByText("Connected to private lobby")).toBeVisible();
    expect(createLobbyMock).toHaveBeenCalledWith({
      name: "Dream debate",
      sides: ["Yes: dreams are vivid", "No: dreams are involuntary"],
      visibility: "private",
      displayName: "Sam",
      intent: "debater",
      sideIndex: 0,
    });
    expect(router.state.location.pathname).toBe("/debates/dream-cheating");
    expect(router.state.location.state.joinResult).toMatchObject({
      lobbyId: "private-lobby-id",
      isCreator: true,
      hostIdentity: "debater-id",
      joinCode: "ABCD23",
      token: "private-creator-token",
    });
    expect(joinTopicByCodeMock).not.toHaveBeenCalled();
  });

  it("looks up a private lobby and offers only its available side or spectating", async () => {
    lookupPrivateLobbyMock.mockResolvedValue({
      id: "dream-cheating",
      lobbyId: "private-lobby-id",
      state: "WAITING",
      title: "Can you cheat in a dream?",
      sides: ["Yes: dreams are vivid", "No: dreams are involuntary"],
      sideAvailability: [false, true],
      debaterCount: 1,
      spectatorCount: 2,
      participants: [],
    });
    joinTopicByCodeMock.mockResolvedValue({
      lobbyId: "private-lobby-id",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes: dreams are vivid", "No: dreams are involuntary"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Sam",
      role: "debater",
      sideIndex: 1,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "private-debater-token",
    });
    const router = createMemoryRouter([
      { path: "/", element: <TopicList topics={[]} /> },
      {
        path: "/debates/:topicId",
        element: <p>Connected to private lobby</p>,
      },
    ]);

    render(<RouterProvider router={router} />);

    expect(
      screen.getByText("No debates are available right now."),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Create or join a topic" }),
    );
    fireEvent.change(screen.getByLabelText("Lobby code"), {
      target: { value: "abcd23" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find lobby" }));

    expect(await screen.findByText("Can you cheat in a dream?")).toBeVisible();
    const sidePicker = screen.getByLabelText("Position");
    expect(within(sidePicker).getAllByRole("option")).toHaveLength(2);
    expect(
      within(sidePicker).getByRole("option", { name: "Spectate" }),
    ).toBeInTheDocument();
    expect(sidePicker).toHaveValue("1");
    fireEvent.change(screen.getByLabelText("Your display name"), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join private lobby" }));

    expect(await screen.findByText("Connected to private lobby")).toBeVisible();
    expect(lookupPrivateLobbyMock).toHaveBeenCalledWith("ABCD23");
    expect(joinTopicByCodeMock).toHaveBeenCalledWith({
      code: "ABCD23",
      displayName: "Sam",
      intent: "debater",
      sideIndex: 1,
    });
  });

  it("allows spectating a private lobby when both sides are taken", async () => {
    lookupPrivateLobbyMock.mockResolvedValue({
      id: "dream-cheating",
      lobbyId: "private-lobby-id",
      state: "WAITING",
      title: "Can you cheat in a dream?",
      sides: ["Yes", "No"],
      sideAvailability: [false, false],
      debaterCount: 2,
      spectatorCount: 0,
      participants: [],
    });
    joinTopicByCodeMock.mockResolvedValue({
      lobbyId: "private-lobby-id",
      state: "WAITING",
      topicId: "dream-cheating",
      topicTitle: "Can you cheat in a dream?",
      sides: ["Yes", "No"],
      participantIdentity: "7ffcd8af-4d5a-45d9-97cc-6db63b930b09",
      displayName: "Sam",
      role: "spectator",
      sideIndex: null,
      isCreator: false,
      hostIdentity: null,
      livekitUrl: "ws://localhost:7880",
      token: "private-spectator-token",
    });
    const router = createMemoryRouter([
      { path: "/", element: <TopicList topics={[]} /> },
      {
        path: "/debates/:topicId",
        element: <p>Connected to private lobby</p>,
      },
    ]);

    render(<RouterProvider router={router} />);

    expect(
      screen.getByText("No debates are available right now."),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Create or join a topic" }),
    );
    fireEvent.change(screen.getByLabelText("Lobby code"), {
      target: { value: "ABCD23" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find lobby" }));
    await screen.findByRole("option", { name: "Spectate" });
    fireEvent.change(screen.getByLabelText("Your display name"), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join private lobby" }));

    expect(await screen.findByText("Connected to private lobby")).toBeVisible();
    expect(joinTopicByCodeMock).toHaveBeenCalledWith({
      code: "ABCD23",
      displayName: "Sam",
      intent: "spectator",
    });
  });
});
