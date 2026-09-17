// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { TopicStatus } from "@impromptu/api/contracts";
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

import Home, { MEDIA_PERMISSION_MESSAGE, TopicList } from "./home";

afterEach(cleanup);

describe("TopicList", () => {
  it("makes role intent explicit before joining", async () => {
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
      },
      {
        id: "moral-lying",
        title: "Is lying ever moral?",
        sides: ["Yes: context matters", "No: lying is always wrong"],
        sideAvailability: [false, false],
        debaterCount: 2,
        spectatorCount: 1,
      },
    ];
    const router = createMemoryRouter([
      { path: "/", element: <TopicList topics={topics} /> },
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

    const dreamTopic = screen
      .getByText("Can you cheat in a dream?")
      .closest<HTMLDivElement>('[data-slot="card"]');
    expect(dreamTopic).not.toBeNull();
    expect(screen.queryByText("Is lying ever moral?")).not.toBeInTheDocument();

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
    fireEvent.click(
      within(dreamTopic!).getByRole("button", {
        name: /Debate.*Yes: intention still matters/,
      }),
    );

    const debaterDialog = screen.getByRole("dialog");
    expect(within(debaterDialog).getByText("Debate this topic")).toBeVisible();
    expect(within(debaterDialog).getByText("Your position")).toBeVisible();
    expect(
      within(debaterDialog).queryByText(
        "You will join as a debater with your camera and microphone.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(debaterDialog).getByPlaceholderText("Display name"),
    ).toBeRequired();
    fireEvent.click(
      within(debaterDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.touchStart(dreamTopic!, {
      touches: [{ clientX: 240 }],
    });
    fireEvent.touchEnd(dreamTopic!, {
      changedTouches: [{ clientX: 120 }],
    });
    const lyingTopic = screen
      .getByText("Is lying ever moral?")
      .closest<HTMLDivElement>('[data-slot="card"]');
    expect(lyingTopic).not.toBeNull();
    const takenSideButtons = within(lyingTopic!).getAllByRole("button", {
      name: /Side taken:/,
    });
    expect(takenSideButtons).toHaveLength(2);
    for (const button of takenSideButtons) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Watch live" }));
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
          loader: () => [],
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
});
