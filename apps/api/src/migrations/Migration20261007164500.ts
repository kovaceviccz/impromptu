import { Migration } from "@mikro-orm/migrations";

export class Migration20261007164500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "private_lobby"
      add column "state" text not null default 'WAITING'
      check ("state" in ('WAITING', 'DEBATE_IN_PROGRESS', 'VOTING', 'ENDED'));
    `);
  }

  override async down(): Promise<void> {
    this.addSql('alter table "private_lobby" drop column "state";');
  }
}
