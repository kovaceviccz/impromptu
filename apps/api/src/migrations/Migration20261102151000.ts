import { Migration } from "@mikro-orm/migrations";

export class Migration20261102151000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "private_lobby" add column "category" text not null default 'Miscellaneous';`,
    );
    this.addSql(
      `alter table "private_lobby" add constraint "private_lobby_category_check" check ("category" in ('Philosophy', 'Society', 'Sports', 'Music', 'Entertainment', 'Miscellaneous'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "private_lobby" drop constraint "private_lobby_category_check";`,
    );
    this.addSql(`alter table "private_lobby" drop column "category";`);
  }
}
