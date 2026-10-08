import { apiContract } from "@impromptu/api/contracts";
import { expect, test } from "@playwright/test";

const baseURL = process.env.LIVE_E2E_BASE_URL ?? "http://127.0.0.1:5173";
test.use({ baseURL });

test("a stale side choice returns home with a visible reason", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const title = `Can both guests take one side ${Date.now()}?`;
  const waitingContext = await browser.newContext({ baseURL });
  const winningContext = await browser.newContext({ baseURL });
  const waiting = await waitingContext.newPage();
  const winning = await winningContext.newPage();
  let created:
    | ReturnType<typeof apiContract.createLobby.response.parse>
    | undefined;
  try {
    await Promise.all([page.goto("/"), waiting.goto("/"), winning.goto("/")]);
    await expect(
      waiting.getByRole("heading", { name: "Can you cheat in a dream?" }),
    ).toBeVisible();
    await expect(
      winning.getByRole("heading", { name: "Can you cheat in a dream?" }),
    ).toBeVisible();
    const initialCount = apiContract.topics.response.parse(
      await (await waiting.request.get("/api/topics")).json(),
    ).length;

    await page.getByRole("button", { name: "Create or join a topic" }).click();
    await page.getByLabel("Topic question").fill(title);
    await page.getByLabel("Affirmative position").fill("Yes, they can");
    await page.getByLabel("Opposing position").fill("No, they cannot");
    await page.getByLabel("Visibility").selectOption("public");
    await page.getByLabel("Creator display name").fill("Host");
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
    await expect(waiting.getByText(`1 of ${initialCount + 1}`)).toBeVisible();
    await expect(winning.getByText(`1 of ${initialCount + 1}`)).toBeVisible();
    for (let index = 0; index < 3; index += 1) {
      await waiting.getByRole("button", { name: "Next topic" }).click();
      await winning.getByRole("button", { name: "Next topic" }).click();
    }
    await waiting
      .getByRole("button", { name: /Debate.*Yes, they can/ })
      .click();
    await waiting.getByPlaceholder("Display name").fill("Waiting guest");
    await winning
      .getByRole("button", { name: /Debate.*Yes, they can/ })
      .click();
    await winning.getByPlaceholder("Display name").fill("First guest");
    await winning
      .getByRole("dialog")
      .getByRole("button", { name: "Debate" })
      .click();
    await expect(winning.getByRole("heading", { name: title })).toBeVisible();

    const rejectedJoin = waiting.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/topics/${created!.topicId}/join`) &&
        response.request().method() === "POST",
    );
    await waiting
      .getByRole("dialog")
      .getByRole("button", { name: "Debate" })
      .click();
    expect((await rejectedJoin).status()).toBe(409);
    await expect(waiting).toHaveURL(/\?lobbyError=/);
    await expect(waiting.getByRole("dialog")).toHaveCount(0);
    await expect(waiting.getByRole("alert")).toContainText(
      "That side was just taken",
    );
  } finally {
    if (created)
      await page.request.post(`/api/topics/${created.topicId}/close`, {
        data: { lobbyId: created.lobbyId, token: created.token },
      });
    await waitingContext.close();
    await winningContext.close();
  }
});
