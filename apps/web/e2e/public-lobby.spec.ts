import { expect, test } from "@playwright/test";
import { apiContract } from "@impromptu/api/contracts";

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
  const initialCount = apiContract.topics.response.parse(
    await (await page.request.get("/api/topics")).json(),
  ).length;
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    await Promise.all([page.goto("/"), viewer.goto("/")]);
    await expect(
      viewer.getByRole("heading", { name: "Can you cheat in a dream?" }),
    ).toBeVisible();
    await viewerContext.setOffline(true);
    await page.getByRole("button", { name: "Create or Join" }).click();
    await page.getByText("Write your own", { exact: true }).click();
    await page.getByText("Miscellaneous", { exact: true }).click();
    await page.getByLabel("Topic question").fill(title);
    await page.getByLabel("Affirmative position").fill("Yes, they can");
    await page.getByLabel("Opposing position").fill("No, they cannot");
    await page.getByLabel("Visibility").selectOption("public");
    await page.getByLabel("Creator display name").fill("Public host");
    await page.getByLabel("Join as").selectOption("spectator");
    await page.getByRole("button", { name: "Create and join" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await viewerContext.setOffline(false);
    await expect(viewer.getByText(`1 of ${initialCount + 1}`)).toBeVisible({
      timeout: 20_000,
    });
    const topicHeading = viewer.getByRole("heading", { name: title });
    for (
      let index = 0;
      index < initialCount && (await topicHeading.count()) === 0;
      index += 1
    ) {
      await viewer.getByRole("button", { name: "Next topic" }).click();
    }
    await expect(topicHeading).toBeVisible();
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
