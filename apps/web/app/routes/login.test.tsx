// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Login, { clientAction, safeRedirect } from "./login";

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

function renderLogin(initialEntry = "/login") {
  const router = createMemoryRouter(
    [
      { path: "/login", action: clientAction, element: <Login /> },
      { path: "/", element: <p>Home</p> },
      { path: "/account", element: <p>Account page</p> },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function submit(identifier: string, password: string) {
  fireEvent.change(screen.getByLabelText("Username or email"), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("Login", () => {
  it("authenticates and returns to the protected page that was requested", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { account }));
    const router = renderLogin("/login?redirectTo=%2Faccount");

    submit("ada_lovelace", "analytical-engine");

    expect(await screen.findByText("Account page")).toBeVisible();
    expect(router.state.location.pathname).toBe("/account");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/login");
    expect(
      JSON.parse(typeof init?.body === "string" ? init.body : "null"),
    ).toEqual({
      identifier: "ada_lovelace",
      password: "analytical-engine",
    });
  });

  it("redirects home when no destination was requested", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { account }));
    const router = renderLogin();

    submit("ada@example.com", "analytical-engine");

    expect(await screen.findByText("Home")).toBeVisible();
    expect(router.state.location.pathname).toBe("/");
  });

  it("denies access with a clear error for invalid credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: "Incorrect username, email, or password." }),
    );
    const router = renderLogin();

    submit("ada_lovelace", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect username, email, or password.",
    );
    expect(router.state.location.pathname).toBe("/login");
  });

  it("validates required fields before contacting the server", async () => {
    renderLogin();

    submit(" ", "");

    expect(
      await screen.findByText("Enter your username or email."),
    ).toBeVisible();
    expect(screen.getByText("Enter your password.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only redirects to same-origin paths", () => {
    expect(safeRedirect("/account")).toBe("/account");
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("/\\evil.example")).toBe("/");
    expect(safeRedirect("https://evil.example")).toBe("/");
    expect(safeRedirect(null)).toBe("/");
  });
});
