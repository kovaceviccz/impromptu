// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AccountPage, { clientAction, clientLoader } from "./account";

const fetchMock = vi.fn<typeof fetch>();
const account = {
  id: "0f7f2c2e-9d1b-4d3c-8f33-5b6f0d8f5a10",
  username: "ada_lovelace",
  email: "ada@example.com",
  createdAt: "2026-09-01T12:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderAccount() {
  const router = createMemoryRouter(
    [
      {
        path: "/account",
        action: clientAction,
        loader: clientLoader,
        element: <AccountPage />,
      },
      { path: "/login", element: <p>Login page</p> },
      { path: "/", element: <p>Home</p> },
    ],
    { initialEntries: ["/account"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Account page", () => {
  it("sends guests to log in and remembers where they were going", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: "Log in to continue." }),
    );

    const router = renderAccount();

    expect(await screen.findByText("Login page")).toBeVisible();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?redirectTo=%2Faccount");
  });

  it("shows the signed-in account on every visit while the session lasts", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { account }));

    const router = renderAccount();

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeVisible();
    expect(screen.getByText("ada@example.com")).toBeVisible();
    expect(screen.getByRole("link", { name: "ada_lovelace" })).toHaveAttribute(
      "href",
      "/account",
    );

    await router.navigate("/");
    await router.navigate("/account");
    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) expect(url).toBe("/api/account");
  });

  it("logs out and returns home", async () => {
    fetchMock.mockImplementation(async (input) =>
      input === "/api/auth/logout"
        ? jsonResponse(200, { status: "ok" })
        : jsonResponse(200, { account }),
    );
    const router = renderAccount();

    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByText("Home")).toBeVisible();
    expect(router.state.location.pathname).toBe("/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
