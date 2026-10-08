import { expect, test, type Page } from "@playwright/test";
import { apiContract } from "@impromptu/api/contracts";

const baseURL = process.env.LIVE_E2E_BASE_URL;
test.skip(!baseURL, "Set LIVE_E2E_BASE_URL to run against a deployed site.");
test.use({ baseURL });

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500)
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

test("live account registration and login show no errors", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const username = `demo_${Date.now().toString(36)}`;
  const password = `Demo-${Date.now()}-pass`;
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Account created" }),
  ).toBeVisible();
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: username })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("live public topic creation, discovery, joining, and closure show no errors", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const guestContext = await browser.newContext({ baseURL });
  const guest = await guestContext.newPage();
  const guestErrors = collectErrors(guest);
  const secondContext = await browser.newContext({ baseURL });
  const second = await secondContext.newPage();
  const secondErrors = collectErrors(second);
  const title = `Demo: Can we debate fairly ${Date.now()}?`;
  let created:
    | ReturnType<typeof apiContract.createLobby.response.parse>
    | undefined;
  try {
    await Promise.all([page.goto("/"), guest.goto("/"), second.goto("/")]);
    const initialCount = apiContract.topics.response.parse(
      await (await guest.request.get("/api/topics")).json(),
    ).length;
    await expect(
      page.getByRole("heading", { name: "Can you cheat in a dream?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create or join a topic" }).click();
    await page.getByLabel("Topic question").fill(title);
    await page
      .getByLabel("Affirmative position")
      .fill("Yes: shared rules can help");
    await page
      .getByLabel("Opposing position")
      .fill("No: context is too important");
    await page.getByLabel("Visibility").selectOption("public");
    await page.getByLabel("Creator display name").fill("Demo host");
    await page.getByLabel("Join as").selectOption("spectator");
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/topics") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create and join" }).click();
    created = apiContract.createLobby.response.parse(
      await (await creation).json(),
    );
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(guest.getByText(`1 of ${initialCount + 1}`)).toBeVisible();
    for (let index = 0; index < 3; index += 1)
      await guest.getByRole("button", { name: "Next topic" }).click();
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
    await guest
      .getByRole("button", { name: /Debate.*Yes: shared rules can help/ })
      .click();
    await guest.getByPlaceholder("Display name").fill("First debater");
    await guest
      .getByRole("dialog")
      .getByRole("button", { name: "Debate" })
      .click();
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      guest
        .getByRole("article")
        .filter({
          has: guest.getByRole("heading", {
            name: "Yes: shared rules can help",
          }),
        })
        .locator("video"),
    ).toBeVisible();
    await expect(second.getByText(`1 of ${initialCount + 1}`)).toBeVisible();
    for (let index = 0; index < 3; index += 1)
      await second.getByRole("button", { name: "Next topic" }).click();
    await second
      .getByRole("button", { name: /Debate.*No: context is too important/ })
      .click();
    await second.getByPlaceholder("Display name").fill("Second debater");
    await second
      .getByRole("dialog")
      .getByRole("button", { name: "Debate" })
      .click();
    await expect(second.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      second
        .getByRole("article")
        .filter({
          has: second.getByRole("heading", {
            name: "No: context is too important",
          }),
        })
        .locator("video"),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Participants 3" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start Debate" }).click();
    await expect(page.getByText("Debate in progress ...")).toBeVisible();
    await expect(guest.getByText("Debate in progress ...")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(guest.getByRole("alert")).toHaveCount(0);
    await expect(second.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
    expect(secondErrors).toEqual([]);
    await page.getByRole("button", { name: "Close lobby" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(guest.getByText("The lobby was closed")).toBeVisible();
  } finally {
    if (created)
      await page.request.post(`/api/topics/${created.topicId}/close`, {
        data: { lobbyId: created.lobbyId, token: created.token },
      });
    await guestContext.close();
    await secondContext.close();
  }
});

test("live private topic code and malformed topic IDs behave safely", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const guestContext = await browser.newContext({ baseURL });
  const guest = await guestContext.newPage();
  const guestErrors = collectErrors(guest);
  const title = `Demo: Should ideas be anonymous ${Date.now()}?`;
  let created:
    | ReturnType<typeof apiContract.createLobby.response.parse>
    | undefined;
  try {
    const invalid = await page.request.post("/api/topics/not-a-uuid/join", {
      data: { intent: "spectator" },
    });
    expect(invalid.status()).toBe(404);
    await Promise.all([page.goto("/"), guest.goto("/")]);
    const initialCount = apiContract.topics.response.parse(
      await (await guest.request.get("/api/topics")).json(),
    ).length;
    await page.getByRole("button", { name: "Create or join a topic" }).click();
    await page.getByLabel("Topic question").fill(title);
    await page
      .getByLabel("Affirmative position")
      .fill("Yes: ideas matter more than names");
    await page
      .getByLabel("Opposing position")
      .fill("No: accountability matters");
    await page.getByLabel("Creator display name").fill("Private demo host");
    await page.getByLabel("Join as").selectOption("spectator");
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/topics") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create and join" }).click();
    created = apiContract.createLobby.response.parse(
      await (await creation).json(),
    );
    const code = created.joinCode!;
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(guest.getByText(`1 of ${initialCount}`)).toBeVisible();
    await guest.getByRole("button", { name: "Create or join a topic" }).click();
    await guest.getByLabel("Lobby code").fill(code);
    await guest.getByRole("button", { name: "Find lobby" }).click();
    await expect(guest.getByText(title)).toBeVisible();
    await guest.getByLabel("Your display name").fill("Private demo guest");
    await guest
      .getByRole("combobox", { name: /^Position/ })
      .selectOption("spectator");
    await guest.getByRole("button", { name: "Join private lobby" }).click();
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(guest.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
    await page.getByRole("button", { name: "Close lobby" }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    if (created)
      await page.request.post(`/api/topics/${created.topicId}/close`, {
        data: { lobbyId: created.lobbyId, token: created.token },
      });
    await guestContext.close();
  }
});
