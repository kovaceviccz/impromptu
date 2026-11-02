import { Migration } from "@mikro-orm/migrations";
export class Migration20261102000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "private_lobby" add column "voting" jsonb null;');
    this.addSql(
      'alter table "public_lobby_state" add column "voting" jsonb null;',
    );
  }
  override async down(): Promise<void> {
    this.addSql('alter table "private_lobby" drop column "voting";');
    this.addSql('alter table "public_lobby_state" drop column "voting";');
  }
}
