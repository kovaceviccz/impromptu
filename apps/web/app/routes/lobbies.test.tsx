// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { PublicLobbySummary } from "@impromptu/api/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import PublicLobbies from "./lobbies";

vi.mock("../api", () => ({
  getPublicLobbies: vi.fn<() => Promise<PublicLobbySummary[]>>(async () => [
    {
      id: "lobby-1",
      question: "Should school start later?",
      visibility: "public",
      participantCount: 3,
      status: "waiting",
    },
  ]),
}));

afterEach(cleanup);

describe("PublicLobbies", () => {
  it("loads public lobbies from the API client", async () => {
    const router = createMemoryRouter(
      [{ path: "/lobbies", element: <PublicLobbies /> }],
      { initialEntries: ["/lobbies"] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Should school start later?")).toBeVisible();
    expect(screen.getByText("3 participants")).toBeVisible();
    expect(screen.getByText("Waiting")).toBeVisible();
  });
});
