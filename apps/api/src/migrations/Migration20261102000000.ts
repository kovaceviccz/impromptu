import { Migration } from "@mikro-orm/migrations";

export class Migration20261102000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "private_lobby" add column "tags" text[] not null default '{}';`,
    );
    this.addSql(
      `alter table "private_lobby" add constraint "private_lobby_tags_check" check ("tags" <@ array['Casual', 'Serious', 'Beginner-friendly', 'Competitive', 'Educational', 'Open-minded']::text[]);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "private_lobby" drop constraint "private_lobby_tags_check";`,
    );
    this.addSql(`alter table "private_lobby" drop column "tags";`);
  }
}
