import { Migration } from "@mikro-orm/migrations";
export class Migration20261029000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "private_lobby" add column "round_ends_at" timestamptz null;',
    );
    this.addSql(
      'alter table "public_lobby_state" add column "round_ends_at" timestamptz null;',
    );
  }
  override async down(): Promise<void> {
    this.addSql('alter table "private_lobby" drop column "round_ends_at";');
    this.addSql(
      'alter table "public_lobby_state" drop column "round_ends_at";',
    );
  }
}
