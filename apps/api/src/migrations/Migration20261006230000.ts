import { Migration } from "@mikro-orm/migrations";

export class Migration20261006230000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "account" add column "display_name" text;');
    this.addSql('update "account" set "display_name" = "username";');
    this.addSql(
      'alter table "account" alter column "display_name" set not null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "account" drop column "display_name";');
  }
}
