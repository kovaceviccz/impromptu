import { expect, test, type Page } from "@playwright/test";
import { apiContract } from "@impromptu/api/contracts";

async function participants(page: Page) {
  await page.getByRole("tab", { name: /Participants/ }).click();
  return page.getByRole("region", { name: "Participants" });
}

async function findPrivate(page: Page, code: string, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Create or join a private lobby",
      exact: true,
    })
    .click();
  await page.getByLabel("Lobby code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Find lobby" }).click();
  await page.getByLabel("Your display name", { exact: true }).fill(name);
}

test("private codes, guests, registered users, reloads, membership recovery and leaving", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Create or join a private lobby",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Creator display name", { exact: true })
    .fill("Acceptance host");
  await page
    .getByRole("combobox", { name: "Join as", exact: true })
    .selectOption("spectator");
  await page.getByRole("button", { name: "Create and join" }).click();
  const code = await page.locator("code").innerText();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  const hostRoster = await participants(page);
  await expect(
    hostRoster.getByText("Acceptance host (you)", { exact: true }),
  ).toBeVisible();
  await expect(hostRoster.getByText("Host", { exact: true })).toHaveCount(1);
  await expect(hostRoster.getByRole("listitem")).toHaveCount(3); // two open debater slots + the host

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto("/");
    await guest
      .getByRole("button", {
        name: "Create or join a private lobby",
        exact: true,
      })
      .click();
    await guest.getByLabel("Lobby code", { exact: true }).fill("ABC");
    await guest.getByRole("button", { name: "Find lobby" }).click();
    await expect(guest.getByRole("alert")).toHaveText(
      "Enter a 6–8 character lobby code using letters and numbers.",
    );
    await guest.getByLabel("Lobby code", { exact: true }).fill("ZZZZZZZZ");
    await guest.getByRole("button", { name: "Find lobby" }).click();
    await expect(guest.getByRole("alert")).toHaveText(
      "Private lobby not found",
    );
    await guest.getByLabel("Lobby code", { exact: true }).fill(code);
    await guest.getByRole("button", { name: "Find lobby" }).click();
    await guest
      .getByLabel("Your display name", { exact: true })
      .last()
      .fill("Acceptance guest");
    await guest
      .getByRole("combobox", { name: "Position", exact: true })
      .last()
      .selectOption("spectator");
    await guest.route("**/api/topics/*/participants", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Participants could not be loaded. Try again.",
        }),
      }),
    );
    let guestJoin:
      | ReturnType<typeof apiContract.joinByCode.response.parse>
      | undefined;
    expect(
      await guest
        .getByLabel("Your display name", { exact: true })
        .evaluate((element) =>
          element instanceof HTMLInputElement
            ? element.validationMessage
            : "Not an input",
        ),
    ).toBe("");
    const joinResponse = guest.waitForResponse(
      (response) => response.url().endsWith("/api/topics/join-code"),
      { timeout: 15_000 },
    );
    await guest.getByRole("button", { name: "Join private lobby" }).click();
    guestJoin = apiContract.joinByCode.response.parse(
      await (await joinResponse).json(),
    );
    expect(guestJoin).not.toHaveProperty("joinCode");
    await expect(guest.getByRole("alert")).toContainText(
      "Participants could not be loaded",
    );
    await expect(guest.getByRole("textbox", { name: "Message" })).toBeEnabled();
    await guest.unroute("**/api/topics/*/participants");
    await guest.getByRole("button", { name: "Retry participant list" }).click();
    await expect(guest.getByRole("alert")).toHaveCount(0);
    const guestRoster = await participants(guest);
    await expect(
      guestRoster.getByText("Acceptance guest (you)", { exact: true }),
    ).toBeVisible();
    await expect(
      hostRoster.getByText("Acceptance guest", { exact: true }),
    ).toBeVisible();
    await expect(guestRoster.getByText("Host", { exact: true })).toHaveCount(1);
    await expect(
      guest.getByRole("button", { name: /Copy lobby code/ }),
    ).toHaveCount(0);

    // Switching roles keeps the host identity visible to the already connected guest.
    await hostRoster
      .getByRole("button", { name: /Debate.*Yes: intention still matters/ })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Debate", exact: true })
      .click();
    await expect(
      guestRoster
        .getByRole("region", { name: /^Debaters/ })
        .getByText("Host", { exact: true }),
    ).toBeVisible();
    await expect(
      guestRoster.getByText("Acceptance host", { exact: true }),
    ).toHaveCount(1);

    // A reload restores the same identity, code and host badge without duplicate membership.
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Copy lobby code ${code}` }),
    ).toBeVisible();
    const restoredRoster = await participants(page);
    await expect(restoredRoster.getByText("Host", { exact: true })).toHaveCount(
      1,
    );
    await expect(
      guestRoster.getByText("Acceptance host", { exact: true }),
    ).toHaveCount(1);
    await expect(
      restoredRoster.getByText("Acceptance guest", { exact: true }),
    ).toHaveCount(1);
    await guest.reload();
    const reconnectedGuest = await participants(guest);
    await expect(
      reconnectedGuest.getByText("Acceptance guest (you)", { exact: true }),
    ).toHaveCount(1);
    await expect(
      reconnectedGuest.getByText("Acceptance host", { exact: true }),
    ).toHaveCount(1);

    // Disconnect networking while membership changes, then verify the SDK resynchronizes.
    await guestContext.setOffline(true);
    await expect.poll(() => guest.evaluate(() => navigator.onLine)).toBe(false);

    // An authenticated participant uses the same code flow with their account display name.
    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    try {
      const username = `private_${Date.now().toString(36)}`;
      const registration = await member.request.post(
        "http://127.0.0.1:5173/api/auth/register",
        {
          data: {
            username,
            email: `${username}@example.com`,
            password: "acceptance-password",
          },
        },
      );
      expect(registration.ok()).toBe(true);
      await findPrivate(member, code, "Registered member");
      await member
        .getByRole("combobox", { name: "Position", exact: true })
        .last()
        .selectOption("spectator");
      await member.getByRole("button", { name: "Join private lobby" }).click();
      const memberRoster = await participants(member);
      await expect(
        memberRoster.getByText("Registered member (you)", { exact: true }),
      ).toBeVisible();
      await expect(
        restoredRoster.getByText("Registered member", { exact: true }),
      ).toBeVisible();
      const synchronized = guest.waitForResponse(
        (response) => response.url().endsWith("/participants") && response.ok(),
      );
      await guestContext.setOffline(false);
      await synchronized;
      await expect(
        reconnectedGuest.getByText("Registered member", { exact: true }),
      ).toHaveCount(1);
      await expect(
        reconnectedGuest.getByText("Acceptance host", { exact: true }),
      ).toHaveCount(1);
      await member.getByRole("button", { name: "Leave lobby" }).click();
      await expect(member).toHaveURL("http://127.0.0.1:5173/");
      await expect(
        restoredRoster.getByText("Registered member", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await memberContext.close();
    }

    await guest.getByRole("button", { name: "Leave lobby" }).click();
    await expect(guest).toHaveURL("http://127.0.0.1:5173/");
    await expect(
      restoredRoster.getByText("Acceptance guest", { exact: true }),
    ).toHaveCount(0);
    const repeated = await guest.request.post(
      "/api/topics/dream-cheating/leave",
      {
        data: {
          lobbyId: guestJoin.lobbyId,
          token: guestJoin.token,
        },
      },
    );
    expect(repeated.ok()).toBe(true);
    expect(
      await guest.evaluate(() =>
        sessionStorage.getItem("impromptu.room.dream-cheating"),
      ),
    ).toBeNull();
    await page.getByRole("button", { name: "Leave lobby" }).click();
    await expect(page).toHaveURL("http://127.0.0.1:5173/");
  } finally {
    await guestContext.close();
  }
});

test("a valid code rejects an occupied debate position and leaves the guest out", async ({
  page,
}) => {
  const creatorResponse = await page.request.post(
    "/api/topics/dream-cheating/private",
    { data: { displayName: "Reservation host", intent: "spectator" } },
  );
  const creator = apiContract.privateTopic.response.parse(
    await creatorResponse.json(),
  );
  const otherResponse = await page.request.post(
    "/api/topics/dream-cheating/private",
    { data: { displayName: "Another host", intent: "spectator" } },
  );
  const other = apiContract.privateTopic.response.parse(
    await otherResponse.json(),
  );
  expect(other.joinCode).not.toBe(creator.joinCode);
  await findPrivate(page, creator.joinCode!, "Blocked guest");
  const reservedResponse = await page.request.post("/api/topics/join-code", {
    data: {
      code: creator.joinCode,
      displayName: "Reserved position",
      intent: "debater",
      sideIndex: 0,
    },
  });
  const reservation = apiContract.joinByCode.response.parse(
    await reservedResponse.json(),
  );
  try {
    await page.getByRole("button", { name: "Join private lobby" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "That side was just taken",
    );
    await expect(page).toHaveURL("http://127.0.0.1:5173/");
  } finally {
    await page.request.post("/api/topics/dream-cheating/leave", {
      data: {
        lobbyId: reservation.lobbyId,
        token: reservation.token,
      },
    });
  }
});
