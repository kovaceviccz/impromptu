// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Register, { clientAction } from "./register";

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

function renderRegister() {
  const router = createMemoryRouter(
    [
      { path: "/register", action: clientAction, element: <Register /> },
      { path: "/", element: <p>Home</p> },
      { path: "/account", element: <p>Account page</p> },
    ],
    { initialEntries: ["/register"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function fill(fields: Partial<Record<string, string>>) {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

describe("Register", () => {
  it("shows field errors without sending an incomplete registration", async () => {
    renderRegister();
    fill({ Email: "not-an-email", Password: "short" });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a username.")).toBeVisible();
    expect(screen.getByText("Enter a valid email address.")).toBeVisible();
    expect(
      screen.getByText("Password must be at least 8 characters."),
    ).toBeVisible();
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Enter a valid email address.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates an account from valid details and confirms it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { account }));
    renderRegister();
    fill({
      Username: " ada_lovelace ",
      Email: "Ada@Example.com",
      Password: "analytical-engine",
    });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByRole("heading", { name: "Account created" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You are signed in as ada_lovelace.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/register");
    expect(init?.method).toBe("POST");
    expect(
      JSON.parse(typeof init?.body === "string" ? init.body : "null"),
    ).toEqual({
      username: "ada_lovelace",
      email: "ada@example.com",
      password: "analytical-engine",
    });
    expect(screen.getByRole("link", { name: "View account" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("shows which details already belong to another account", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        message: "An account with these details already exists.",
        fieldErrors: { username: "This username is already taken." },
      }),
    );
    renderRegister();
    fill({
      Username: "ada_lovelace",
      Email: "someone@example.com",
      Password: "analytical-engine",
    });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("This username is already taken."),
    ).toBeVisible();
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(
      screen.queryByRole("heading", { name: "Account created" }),
    ).toBeNull();
  });

  it("reports a failure that is not tied to a field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { message: "Internal Server Error" }),
    );
    renderRegister();
    fill({
      Username: "ada_lovelace",
      Email: "ada@example.com",
      Password: "analytical-engine",
    });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Internal Server Error",
      ),
    );
  });
});
