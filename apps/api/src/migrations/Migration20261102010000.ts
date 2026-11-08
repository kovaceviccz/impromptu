import { Migration } from "@mikro-orm/migrations";

export class Migration20261102010000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "debate_result" (
        "id" uuid not null,
        "lobby_id" text not null,
        "account_id" uuid not null,
        "outcome" text not null,
        "created_at" timestamptz not null default now(),
        constraint "debate_result_pkey" primary key ("id"),
        constraint "debate_result_outcome_check" check ("outcome" in ('win', 'loss', 'draw')),
        constraint "debate_result_account_id_foreign" foreign key ("account_id") references "account" ("id") on delete cascade
      );`,
    );
    this.addSql(
      'create unique index "debate_result_lobby_account_key" on "debate_result" ("lobby_id", "account_id");',
    );
    this.addSql(
      'create index "debate_result_account_id_idx" on "debate_result" ("account_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "debate_result";');
  }
}
