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
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
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

  it("edits the username and email", async () => {
    const updatedAccount = {
      ...account,
      username: "ada_byron",
      email: "byron@example.com",
    };
    let currentAccount = account;
    fetchMock.mockImplementation(async (input, init) => {
      if (input === "/api/account" && init?.method === "PATCH") {
        currentAccount = updatedAccount;
        return jsonResponse(200, { account: updatedAccount });
      }
      return jsonResponse(200, { account: currentAccount });
    });
    renderAccount();

    fireEvent.change(await screen.findByLabelText("Username"), {
      target: { value: "ada_byron" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "byron@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile updated.")).toBeVisible();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account",
        expect.objectContaining({
          body: JSON.stringify({
            username: "ada_byron",
            email: "byron@example.com",
          }),
          method: "PATCH",
        }),
      ),
    );
  });

  it("shows profile validation errors", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (input === "/api/account" && init?.method === "PATCH") {
        return jsonResponse(409, {
          message: "An account with these details already exists.",
          fieldErrors: { username: "This username is already taken." },
        });
      }
      return jsonResponse(200, { account });
    });
    renderAccount();

    fireEvent.change(await screen.findByLabelText("Username"), {
      target: { value: "existing_user" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This username is already taken."),
    ).toBeVisible();
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("requires confirmation before deleting the account", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (input === "/api/account" && init?.method === "DELETE") {
        return jsonResponse(200, { status: "ok" });
      }
      return jsonResponse(200, { account });
    });
    const router = renderAccount();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    expect(
      screen.getByRole("heading", { name: "Delete your account?" }),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === "/api/account" && init?.method === "DELETE",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Permanently delete" }));

    expect(await screen.findByText("Home")).toBeVisible();
    expect(router.state.location.pathname).toBe("/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
