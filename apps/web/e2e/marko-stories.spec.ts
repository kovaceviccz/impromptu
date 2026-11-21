import {
  apiContract,
  PRODUCT,
  type JoinResult,
} from "@impromptu/api/contracts";
import { expect, test } from "./lobby-fixture";
import type { Page } from "@playwright/test";

async function enter(page: Page, join: JoinResult) {
  await page.goto("/");
  await page.evaluate(
    ({ value, key }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { value: join, key: `${PRODUCT.name}.room.${join.topicId}` },
  );
  await page.goto(`/debates/${join.topicId}`);
}

test("shares a private invitation with a separate guest session and captures host email in the protected mailbox", async ({
  page,
  browser,
  trackLobby,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const login = await page.request.post(apiContract.login.path, {
    data: { identifier: "demo_host", password: "DemoOnly2026!" },
  });
  expect(login.ok()).toBeTruthy();
  const created = await page.request.post(apiContract.createLobby.path, {
    data: {
      name: `Sprint invitation ${Date.now()}`,
      sides: ["Invited affirmative", "Invited opposing"],
      category: "Society",
      visibility: "private",
      displayName: "Host",
      intent: "spectator",
    },
  });
  const host = apiContract.createLobby.response.parse(await created.json());
  trackLobby(host);
  await enter(page, host);
  await page
    .getByRole("button", { name: "Invite people", exact: true })
    .click();
  const linkResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/invitation") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Copy invitation link" }).click();
  const invitation = apiContract.invitation.response.parse(
    await (await linkResponse).json(),
  );
  await expect(page.getByText("Invitation link copied.")).toBeVisible();
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(
      invitation.url.replace("http://localhost:5173", "http://127.0.0.1:5173"),
    );
    await expect(
      guest.getByRole("heading", { name: host.topicTitle }),
    ).toBeVisible();
    await expect(
      guest.getByText("No account is required.", { exact: false }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Spectate", exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/debates/${host.topicId}`));
    await expect(
      guest.getByRole("heading", { name: host.topicTitle }),
    ).toBeVisible();
    expect((await guest.request.get("/mail/")).status()).toBe(403);
    await page
      .getByLabel("Recipient email")
      .fill(`teacher_${Date.now()}@example.test`);
    await page
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await expect(
      page.getByText("Invitation submitted to the mailbox."),
    ).toBeVisible();
    const mailbox = await page.request.get("/mail/api/v1/messages");
    expect(mailbox.ok()).toBeTruthy();
    expect(await mailbox.text()).toContain("Join the debate");
    await page.goto("/mail/");
    await expect(
      page.getByText("Join the debate", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("recovers a password from captured mail and invalidates the old account session", async ({
  page,
  browser,
}) => {
  const { z } = await import("zod");
  const email = `recovery_${Date.now()}@example.test`;
  const username = `recovery_${Date.now()}`;
  expect(
    (
      await page.request.post(apiContract.register.path, {
        data: { username, email, password: "OriginalDemo2026!" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Request reset link" }).click();
  await expect(
    page.getByText(
      "If an eligible account exists, a password reset email has been submitted.",
    ),
  ).toBeVisible();
  const mailboxReader = await browser.newContext();
  try {
    expect(
      (
        await mailboxReader.request.post(
          "http://127.0.0.1:5173/api/auth/login",
          {
            data: { identifier: "demo_host", password: "DemoOnly2026!" },
          },
        )
      ).ok(),
    ).toBeTruthy();
    const inbox = z
      .object({
        messages: z.array(
          z.object({
            ID: z.string(),
            Subject: z.string(),
            To: z.array(z.object({ Address: z.string() })),
          }),
        ),
      })
      .parse(
        await (
          await mailboxReader.request.get(
            "http://127.0.0.1:5173/mail/api/v1/messages",
          )
        ).json(),
      );
    const message = inbox.messages.find(
      (item) =>
        item.Subject === "Reset password" &&
        item.To.some((recipient) => recipient.Address === email),
    );
    expect(message).toBeDefined();
    const detail = z
      .object({ Text: z.string() })
      .parse(
        await (
          await mailboxReader.request.get(
            `http://127.0.0.1:5173/mail/api/v1/message/${message!.ID}`,
          )
        ).json(),
      );
    const url = detail.Text.trim().split("\n").at(-1)!;
    await page.goto(
      url.replace("http://localhost:5173", "http://127.0.0.1:5173"),
    );
    await page
      .getByLabel("New password", { exact: true })
      .fill("ChangedDemo2026!");
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill("ChangedDemo2026!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByText("Password changed. You can now log in."),
    ).toBeVisible();
    expect((await page.request.get(apiContract.account.path)).status()).toBe(
      401,
    );
    expect(
      (
        await page.request.post(apiContract.login.path, {
          data: { identifier: email, password: "OriginalDemo2026!" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await page.request.post(apiContract.login.path, {
          data: { identifier: email, password: "ChangedDemo2026!" },
        })
      ).status(),
    ).toBe(200);
    await page.goto(
      url.replace("http://localhost:5173", "http://127.0.0.1:5173"),
    );
    await page
      .getByLabel("New password", { exact: true })
      .fill("AnotherDemo2026!");
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill("AnotherDemo2026!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByText(
        "This reset link is invalid or expired. Request a new link.",
      ),
    ).toBeVisible();
  } finally {
    await mailboxReader.close();
  }
});

test("keeps invitations usable on narrow screens and joins when room storage is blocked", async ({
  page,
  browser,
  trackLobby,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    (
      await page.request.post(apiContract.login.path, {
        data: { identifier: "demo_host", password: "DemoOnly2026!" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Mailbox", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "demo_host" })).toBeVisible();
  expect(
    await page
      .locator("header")
      .first()
      .evaluate((element) => element.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(320);
  const watch = page.getByRole("button", { name: "Watch live", exact: true });
  const create = page.getByRole("button", {
    name: "Create debate",
    exact: true,
  });
  const watchBox = await watch.boundingBox();
  const createBox = await create.boundingBox();
  expect(watchBox!.y + watchBox!.height).toBeLessThanOrEqual(createBox!.y);
  const host = apiContract.createLobby.response.parse(
    await (
      await page.request.post(apiContract.createLobby.path, {
        data: {
          name: `Mobile invitation ${Date.now()}`,
          sides: ["A".repeat(120), "B".repeat(120)],
          category: "Society",
          visibility: "private",
          displayName: "Mobile host",
          intent: "spectator",
        },
      })
    ).json(),
  );
  trackLobby(host);
  await enter(page, host);
  const leaveBox = await page
    .getByRole("button", { name: "Close lobby", exact: true })
    .boundingBox();
  const settingsBox = await page
    .getByRole("button", {
      name: "Camera and microphone settings",
      exact: true,
    })
    .boundingBox();
  const invitationBox = await page
    .getByRole("button", { name: "Invite people", exact: true })
    .boundingBox();
  expect(settingsBox!.height).toBe(leaveBox!.height);
  expect(invitationBox!.height).toBe(leaveBox!.height);
  const mediaBefore = await page.getByRole("article").first().boundingBox();
  await page
    .getByRole("button", { name: "Invite people", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);
  const mediaDuring = await page.locator("article").first().boundingBox();
  expect(mediaDuring).toEqual(mediaBefore);
  await page.getByLabel("Recipient email").fill("not-an-address");
  await page
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(page.getByLabel("Recipient email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Clipboard access denied", "NotAllowedError");
    };
  });
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith("/invitation") &&
      result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Copy invitation link" }).click();
  const invitation = apiContract.invitation.response.parse(
    await (await response).json(),
  );
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(
    invitation.url,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Invite people", exact: true }),
  ).toBeFocused();
  const context = await browser.newContext({
    viewport: { width: 320, height: 740 },
  });
  try {
    await context.addInitScript((prefix) => {
      // oxlint-disable-next-line typescript/unbound-method -- The native receiver is preserved with .call below.
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith(prefix))
          throw new DOMException("Room storage is disabled", "SecurityError");
        return original.call(this, key, value);
      };
    }, `${PRODUCT.name}.room.`);
    const guest = await context.newPage();
    guest.on("pageerror", (error) => errors.push(error.message));
    await guest.goto(
      invitation.url.replace("http://localhost:5173", "http://127.0.0.1:5173"),
    );
    await expect(
      guest.getByRole("heading", { name: host.topicTitle }),
    ).toBeVisible();
    expect(
      await guest.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    const buttons = guest.getByRole("button", {
      name: "Choose this position",
      exact: true,
    });
    const bounds = await buttons.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().right),
    );
    expect(bounds.every((right) => right <= 320)).toBe(true);
    await buttons.first().click();
    await expect(buttons.first()).toHaveAttribute("aria-pressed", "true");
    await guest.getByRole("button", { name: "Spectate", exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/debates/${host.topicId}`));
    await expect(
      guest.getByRole("heading", { name: host.topicTitle }),
    ).toBeVisible();
    await expect(guest.getByRole("article")).toHaveCount(2);
    const paneBounds = await guest
      .getByRole("article")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, right: box.right, y: box.y };
        }),
      );
    expect(paneBounds).toHaveLength(2);
    expect(paneBounds[0].y).toBe(paneBounds[1].y);
    expect(paneBounds[0].right).toBeLessThanOrEqual(paneBounds[1].x);
    expect(paneBounds[1].right).toBeLessThanOrEqual(320);
    await guest
      .getByRole("button", { name: "Leave lobby", exact: true })
      .click();
    await expect(guest).toHaveURL(/\/$/);
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
