import { Migration } from "@mikro-orm/migrations";

export class Migration20260930000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "private_lobby" (
        "id" uuid primary key,
        "topic_id" text not null,
        "code_hash" char(64) not null unique,
        "creator_identity" uuid not null,
        "created_at" timestamptz not null default now(),
        "expires_at" timestamptz null
      );
    `);
    this.addSql(
      'create index "private_lobby_expires_at_idx" on "private_lobby" ("expires_at") where "expires_at" is not null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "private_lobby" cascade;');
  }
}
