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
  await expect(
    page.getByRole("heading", { name: "Debaters 1 of 2" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Spectators 0" }),
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
      "Both debater positions are taken. You can still join as a spectator.",
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
  await expect(
    page.getByRole("heading", { name: "Debaters 1 of 2" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  const spectator = await page.context().newPage();
  await spectator.goto("/");
  await spectator.getByRole("button", { name: "Watch live" }).click();
  await expect(
    spectator.getByRole("textbox", { name: "Display name" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Spectators 1" }),
  ).toBeVisible();

  const noVote = spectator.getByRole("button", {
    name: /No: dreams are involuntary.*vote/,
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

test("participants switch between spectating and debating in the room", async ({
  page,
}) => {
  await page.goto("/");
  const topic = page.locator('[data-slot="card"]');
  await topic.getByRole("button", { name: "Watch live" }).click();

  const participants = page.getByRole("region", { name: "Participants" });
  const debaters = participants.getByRole("region", { name: /^Debaters/ });
  const spectators = participants.getByRole("region", { name: /^Spectators/ });
  await expect(spectators.getByText("Spectator (you)")).toBeVisible();

  await debaters
    .getByRole("button", { name: /Debate.*No: dreams are involuntary/ })
    .click();
  await page
    .getByRole("dialog")
    .getByPlaceholder("Display name")
    .fill("Switcher");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Debate" })
    .click();

  await expect(debaters.getByText("Switcher (you)")).toBeVisible({
    timeout: 15_000,
  });
  await expect(spectators.getByText("No spectators yet.")).toBeVisible();
  await expect(page.getByTitle("Only spectators can vote.")).toBeVisible();

  await debaters.getByRole("button", { name: "Spectate" }).click();
  await expect(spectators.getByText("Spectator (you)")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Debaters 0 of 2" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Leave debate" }).click();
  await expect(topic.getByText("Both sides open")).toBeVisible();
});

test("registers, keeps the session, logs out, and logs back in", async ({
  page,
}) => {
  const username = `e2e_${Date.now().toString(36)}`;
  const password = "e2e-password-123";

  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?redirectTo=%2Faccount$/);

  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter a username.")).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Account created" }),
  ).toBeVisible();

  await page.reload();
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
  await expect(page.getByText(`${username}@example.com`)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Incorrect username, email, or password.",
  );

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: username })).toBeVisible();
});
