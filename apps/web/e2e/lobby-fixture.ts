import { apiContract, type JoinResult } from "@impromptu/api/contracts";
import { test as base, type Response } from "@playwright/test";

// Release memberships even when an assertion fails, so retries can claim the host.
export const test = base.extend<{ trackLobby: (join: JoinResult) => void }>({
  trackLobby: [
    async ({ context }, use) => {
      const joins = new Map<string, JoinResult>();
      const pending: Promise<void>[] = [];
      const track = (join: JoinResult) => {
        joins.set(`${join.lobbyId}:${join.participantIdentity}`, join);
      };
      const onResponse = (response: Response) => {
        if (response.request().method() !== "POST" || !response.ok()) return;
        if (
          !/\/api\/topics(?:$|\/[^/]+\/join$|\/join-code$)/.test(
            new URL(response.url()).pathname,
          )
        )
          return;
        pending.push(
          response.json().then((body: unknown) => {
            const result = apiContract.join.response.safeParse(body);
            if (result.success) track(result.data);
          }),
        );
      };
      context.on("response", onResponse);
      await use(track);
      context.off("response", onResponse);
      await Promise.all(pending);
      for (const join of [...joins.values()].reverse()) {
        const path = join.isCreator && join.lobbyName ? "close" : "leave";
        const response = await context.request.post(
          `/api/topics/${join.topicId}/${path}`,
          {
            data: { lobbyId: join.lobbyId, token: join.token },
          },
        );
        // Closing a created lobby also removes its other memberships.
        if (!response.ok() && response.status() !== 404)
          throw new Error(`Lobby cleanup failed: ${response.status()}`);
      }
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
