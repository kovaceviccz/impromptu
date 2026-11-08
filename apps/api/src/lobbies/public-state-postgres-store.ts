import type { MikroORM } from "@mikro-orm/postgresql";

import { PublicLobbyStateEntity } from "./public-state-entity.js";
import type {
  PublicLobbyState,
  PublicLobbyStateStore,
} from "./public-state.js";

export function createPostgresPublicLobbyStateStore(
  orm: MikroORM,
): PublicLobbyStateStore {
  return {
    async claimHost(topicId, identity) {
      const em = orm.em.fork();
      await em.getConnection().execute(
        `insert into "public_lobby_state" ("topic_id", "host_identity")
         values (?, ?)
         on conflict ("topic_id") do update
         set "host_identity" = coalesce("public_lobby_state"."host_identity", excluded."host_identity")`,
        [topicId, identity],
      );
      const row = await em.findOneOrFail(PublicLobbyStateEntity, { topicId });
      return toRecord(row);
    },
    async find(topicId) {
      const row = await orm.em.fork().findOne(PublicLobbyStateEntity, {
        topicId,
      });
      return row ? toRecord(row) : undefined;
    },
    async updateHost(topicId, expectedIdentity, identity) {
      const updated = await orm.em
        .fork()
        .nativeUpdate(
          PublicLobbyStateEntity,
          { topicId, hostIdentity: expectedIdentity },
          { hostIdentity: identity },
        );
      return updated > 0;
    },
    async updateState(topicId, expectedState, state, roundEndsAt, voting) {
      const updated = await orm.em.fork().nativeUpdate(
        PublicLobbyStateEntity,
        { topicId, state: expectedState },
        {
          state,
          ...(roundEndsAt !== undefined ? { roundEndsAt } : {}),
          ...(voting !== undefined ? { voting } : {}),
        },
      );
      return updated > 0;
    },
    async dueRounds(now) {
      return (
        await orm.em.fork().find(PublicLobbyStateEntity, {
          state: "DEBATE_IN_PROGRESS",
          roundEndsAt: { $lte: now },
        })
      ).map(toRecord);
    },
    async dueVotes(now) {
      return (
        await orm.em.fork().find(PublicLobbyStateEntity, { state: "VOTING" })
      )
        .map(toRecord)
        .filter(
          (lobby) =>
            lobby.voting && Date.parse(lobby.voting.endsAt) <= now.getTime(),
        );
    },
    async submitVote(id, identity, choice) {
      const rows: unknown[] = await orm.em
        .fork()
        .getConnection()
        .execute(
          `update "public_lobby_state" set voting = jsonb_set(voting, '{votes}', (voting->'votes') || jsonb_build_object(?::text, ?::text))
         where "topic_id" = ? and state = 'VOTING' and (voting->>'endsAt')::timestamptz > clock_timestamp()
         and jsonb_exists(voting->'eligible', ?::text) returning "topic_id"`,
          [identity, choice, id, identity],
        );
      return rows.length > 0;
    },
    async close() {},
  };
}

function toRecord(entity: PublicLobbyStateEntity): PublicLobbyState {
  return {
    topicId: entity.topicId,
    hostIdentity: entity.hostIdentity,
    state: entity.state,
    roundEndsAt: entity.roundEndsAt,
    voting: entity.voting,
  };
}
