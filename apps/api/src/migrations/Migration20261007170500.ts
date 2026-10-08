import { Migration } from "@mikro-orm/migrations";

export class Migration20261007170500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "public_lobby_state" (
        "topic_id" text primary key,
        "host_identity" uuid null,
        "state" text not null default 'WAITING'
          check ("state" in ('WAITING', 'DEBATE_IN_PROGRESS', 'VOTING', 'ENDED'))
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "public_lobby_state";');
  }
}
