import { expect, test } from "@playwright/test";
import { apiContract } from "@impromptu/api/contracts";

test("loads backend topics and enters a debate", async ({ page }) => {
  let joinRequests = 0;
  let leaveRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/join")) {
      joinRequests += 1;
    }
    if (request.method() === "POST" && request.url().endsWith("/leave")) {
      leaveRequests += 1;
    }
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Choose a topic and side to debate",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Can you cheat in a dream?" }),
  ).toBeVisible();
  const topic = page.locator('[data-slot="card"]');
  await expect(topic.getByText("Both sides open")).toBeVisible();
  await expect(
    topic.getByText("Yes: intention still matters", { exact: true }),
  ).toBeVisible();
  await expect(
    topic.getByText("No: dreams are involuntary", { exact: true }),
  ).toBeVisible();

  await topic
    .getByRole("button", {
      name: /Debate.*Yes: intention still matters/,
    })
    .click();
  const preJoin = page.getByRole("dialog");
  await expect(preJoin.getByText("Debate this topic")).toBeVisible();
  await expect(preJoin.getByText("Your position")).toBeVisible();
  await expect(
    preJoin.getByText(
      "You will join as a debater with your camera and microphone.",
    ),
  ).toHaveCount(0);
  await preJoin.getByPlaceholder("Display name").fill("Playwright Guest");
  await preJoin.getByRole("button", { name: "Debate" }).click();

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Can you cheat in a dream?",
    }),
  ).toBeVisible();
  await expect(page.getByText("Sides filled")).toBeVisible();
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Spectators").locator("..").getByText("0", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTitle("Only spectators can vote.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Yes: intention still matters/ }),
  ).toHaveCount(0);
  const firstSide = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Yes: intention still matters",
    }),
  });
  await expect(firstSide.locator("video")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Leave debate" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Choose a topic and side to debate",
    }),
  ).toBeVisible();
  await expect(topic.getByText("Both sides open")).toBeVisible();
  expect(joinRequests).toBe(1);
  expect(leaveRequests).toBe(1);

  const reservations = await Promise.all(
    ["Reserved debater one", "Reserved debater two"].map(
      async (displayName, sideIndex) => {
        const response = await page.request.post(
          "/api/topics/dream-cheating/join",
          {
            data: { displayName, intent: "debater", sideIndex },
          },
        );
        expect(response.ok()).toBe(true);
        return apiContract.join.response.parse(await response.json());
      },
    ),
  );

  await topic
    .getByRole("button", {
      name: /Debate.*Yes: intention still matters/,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByPlaceholder("Display name")
    .fill("Race Guest");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Debate" })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Side unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "That side was just taken. Choose another side or spectate instead.",
    ),
  ).toBeVisible();

  await Promise.all(
    reservations.map((reservation) =>
      page.request.post("/api/topics/dream-cheating/leave", {
        data: { participantIdentity: reservation.participantIdentity },
      }),
    ),
  );

  await page.getByRole("button", { name: "Spectate debate" }).click();
  await expect(
    page.getByRole("textbox", { name: "Display name" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave debate" }).click();
  await expect(topic.getByText("Both sides open")).toBeVisible();
  expect(joinRequests).toBe(3);
  expect(leaveRequests).toBe(2);

  await page.goto("/debates/dream-cheating");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Choose a topic and side to debate",
    }),
  ).toBeVisible();
  expect(joinRequests).toBe(3);
});

test("spectators can chat while debaters have a read-only view", async ({
  page,
}) => {
  await page.goto("/");
  const dreamTopic = page.locator('[data-slot="card"]');
  await dreamTopic
    .getByRole("button", {
      name: /Debate.*Yes: intention still matters/,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByPlaceholder("Display name")
    .fill("Debater Guest");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Debate" })
    .click();
  await expect(page.getByText("Sides filled", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  const spectator = await page.context().newPage();
  await spectator.goto("/");
  await spectator.getByRole("button", { name: "Watch live" }).click();
  await expect(
    spectator.getByRole("textbox", { name: "Display name" }),
  ).toBeVisible();
  await expect(
    page.getByText("Spectators").locator("..").getByText("1", { exact: true }),
  ).toBeVisible();

  const noVote = spectator.getByRole("button", {
    name: /No: dreams are involuntary/,
  });
  await noVote.click();
  await expect(page.getByText("1 vote", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Only spectators can vote.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Yes: intention still matters/ }),
  ).toHaveCount(0);
  await expect(spectator.getByText("1 spectator vote")).toBeVisible();

  await noVote.click();
  await expect(noVote).toHaveAttribute("aria-pressed", "false");
  await expect(spectator.getByText("0 spectator votes")).toBeVisible();

  await spectator
    .getByRole("textbox", { name: "Display name" })
    .fill("Spectator Guest");
  await spectator.getByRole("button", { name: "Continue" }).click();
  await spectator
    .getByRole("textbox", { name: "Message" })
    .fill("Hello from spectator");
  await spectator.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Hello from spectator/)).toBeVisible();
  await expect(page.locator("time")).toHaveText(/\d{1,2}:\d{2}/);
  await expect(page.locator("time")).toHaveAttribute("datetime", /^\d{4}-/);

  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(
    0,
  );

  await spectator.getByRole("button", { name: "Leave debate" }).click();
  await page.getByRole("button", { name: "Leave debate" }).click();
});
