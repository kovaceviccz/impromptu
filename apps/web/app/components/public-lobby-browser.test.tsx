// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicLobbySummary } from "@impromptu/api/contracts";

import { PublicLobbyBrowser, PublicLobbyCard } from "./public-lobby-browser";

afterEach(cleanup);

describe("PublicLobbyBrowser", () => {
  function lobby(overrides: Partial<PublicLobbySummary>): PublicLobbySummary {
    return {
      id: "lobby-1",
      question: "Should school start later?",
      visibility: "public",
      participantCount: 0,
      status: "waiting",
      ...overrides,
    };
  }

  it("shows a loading state while retrieval is pending", () => {
    render(
      <PublicLobbyBrowser
        loadLobbies={() => new Promise<PublicLobbySummary[]>(() => {})}
      />,
    );

    expect(screen.getByText("Loading public lobbies…")).toBeVisible();
  });

  it("sorts lobbies and shows counts and statuses", async () => {
    const lobbies: PublicLobbySummary[] = [
      lobby({
        id: "b",
        question: "Zebra",
        participantCount: 2,
        status: "active",
      }),
      lobby({ id: "a", question: "Alpha", participantCount: 1 }),
    ];
    render(<PublicLobbyBrowser loadLobbies={async () => lobbies} />);

    const list = await screen.findByRole("region", { name: "Public lobbies" });
    const cards = within(list).getAllByText(/Alpha|Zebra/);
    expect(cards.map((card) => card.textContent)).toEqual(["Alpha", "Zebra"]);
    expect(within(list).getByText("1 participant")).toBeVisible();
    expect(within(list).getByText("2 participants")).toBeVisible();
    expect(within(list).getByText("Waiting")).toBeVisible();
    expect(within(list).getByText("Active")).toBeVisible();
    expect(lobbies[0]?.question).toBe("Zebra");
  });

  it("shows an empty state", async () => {
    render(<PublicLobbyBrowser loadLobbies={async () => []} />);
    expect(
      await screen.findByText("No public lobbies are available right now."),
    ).toBeVisible();
  });

  it("retries after a failed load", async () => {
    const loadLobbies = vi
      .fn<() => Promise<PublicLobbySummary[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([lobby({ id: "a", question: "Alpha" })]);
    render(<PublicLobbyBrowser loadLobbies={loadLobbies} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load public lobbies.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeVisible());
    expect(loadLobbies).toHaveBeenCalledTimes(2);
  });
});

describe("PublicLobbyCard", () => {
  it("uses singular participant text for a count of one", () => {
    render(
      <PublicLobbyCard
        lobby={{
          id: "one-person",
          question: "Starter Lobby",
          visibility: "public",
          participantCount: 1,
          status: "waiting",
        }}
      />,
    );

    expect(screen.getByText("Starter Lobby")).toBeVisible();
    expect(screen.getByText("1 participant")).toBeVisible();
    expect(screen.getByText("Waiting")).toBeVisible();
  });
});
