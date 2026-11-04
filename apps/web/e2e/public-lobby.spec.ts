import { expect, test } from "./lobby-fixture";

test("the starter topic card reflects its live room", async ({
  page,
  browser,
}) => {
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    await Promise.all([page.goto("/"), viewer.goto("/")]);
    await Promise.all([
      page.getByRole("button", { name: "Next topic" }).click(),
      viewer.getByRole("button", { name: "Next topic" }).click(),
    ]);
    await expect(
      viewer.getByRole("heading", { name: "Is lying ever moral?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Watch live" }).click();
    await page.getByRole("button", { name: "Continue to lobby" }).click();
    await expect(viewer.getByText("1 person watching")).toBeVisible();
    await page.getByRole("button", { name: "Leave lobby" }).click();
    await expect(viewer.getByText("No one watching")).toBeVisible();
  } finally {
    await viewerContext.close();
  }
});

test("creating a public topic creates its only lobby and closing it removes the card", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const title = `Can machines dream ${Date.now()}?`;
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    await Promise.all([page.goto("/"), viewer.goto("/")]);
    await expect(
      viewer.getByRole("heading", { name: "Can you cheat in a dream?" }),
    ).toBeVisible();
    await viewerContext.setOffline(true);
    await page.getByRole("button", { name: "Create or join a topic" }).click();
    await page.getByLabel("Topic question").fill(title);
    await page.getByLabel("Affirmative position").fill("Yes, they can");
    await page.getByLabel("Opposing position").fill("No, they cannot");
    await page.getByLabel("Visibility").selectOption("public");
    await page.getByLabel("Creator display name").fill("Public host");
    await page.getByLabel("Join as").selectOption("spectator");
    await page.getByRole("button", { name: "Create and join" }).click();
    await page.getByRole("button", { name: "Continue to lobby" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await viewerContext.setOffline(false);
    await expect(viewer.getByText("1 of 4")).toBeVisible({ timeout: 20_000 });
    for (let index = 0; index < 3; index += 1) {
      await viewer.getByRole("button", { name: "Next topic" }).click();
    }
    await expect(viewer.getByRole("heading", { name: title })).toBeVisible();
    await expect(viewer.getByText("4 of 4")).toBeVisible();
    await expect(viewer.getByText("1 person watching")).toBeVisible();
    await viewer.getByRole("button", { name: "Watch live" }).click();
    await expect(viewer.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Participants 2" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close lobby" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(viewer.getByText("The lobby was closed")).toBeVisible();
    await viewer.getByRole("button", { name: "Go to home" }).click();
    await expect(viewer.getByText(title)).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
});

test("public positions reopen after the completed round's debaters leave", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const title = `Reusable public lobby ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create or join a topic" }).click();
  await page.getByLabel("Topic question").fill(title);
  await page.getByLabel("Affirmative position").fill("Yes, reuse it");
  await page.getByLabel("Opposing position").fill("No, close it");
  await page.getByLabel("Visibility").selectOption("public");
  await page.getByLabel("Creator display name").fill("Host");
  await page.getByLabel("Join as").selectOption("spectator");
  await page.getByRole("button", { name: "Create and join" }).click();
  await page.getByRole("button", { name: "Continue to lobby" }).click();
  const guests = [];
  for (const side of ["Yes, reuse it", "No, close it"]) {
    const guest = await page.context().newPage();
    guests.push(guest);
    await guest.goto("/");
    for (let index = 0; index < 3; index++)
      await guest.getByRole("button", { name: "Next topic" }).click();
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
    await guest
      .getByRole("button", { name: new RegExp(`Debate.*${side}`) })
      .click();
    await guest.getByPlaceholder("Display name").fill(side);
    await guest
      .getByRole("dialog")
      .getByRole("button", { name: "Debate", exact: true })
      .click();
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.getByRole("button", { name: "Start Debate", exact: true }).click();
  await page.getByRole("button", { name: "End round", exact: true }).click();
  await expect(page.getByRole("region", { name: "Round results" })).toBeVisible(
    { timeout: 35_000 },
  );
  for (const guest of guests)
    await guest.getByRole("button", { name: "Leave lobby" }).click();
  for (const guest of guests) {
    for (let index = 0; index < 3; index++)
      await guest.getByRole("button", { name: "Next topic" }).click();
    await expect(guest.getByRole("heading", { name: title })).toBeVisible();
    await expect(guest.getByText("Both sides open")).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Start Debate", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Round results" }),
  ).toBeVisible();
  await guests[0]
    .getByRole("button", { name: /Debate.*Yes, reuse it/ })
    .click();
  await guests[0].getByPlaceholder("Display name").fill("Next debater");
  await guests[0]
    .getByRole("dialog")
    .getByRole("button", { name: "Debate", exact: true })
    .click();
  await expect(guests[0].getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Close lobby" }).click();
});
