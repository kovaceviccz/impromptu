import { Migration } from "@mikro-orm/migrations";

export class Migration20261008000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "private_lobby" add column "name" text;`);
    this.addSql(`alter table "private_lobby" add column "side_0" text;`);
    this.addSql(`alter table "private_lobby" add column "side_1" text;`);
    this.addSql(
      `alter table "private_lobby" add column "visibility" text not null default 'private';`,
    );
    this.addSql(
      `update "private_lobby" set "name" = "topic_id" where "name" is null;`,
    );
    this.addSql(
      `alter table "private_lobby" alter column "name" set not null;`,
    );
    this.addSql(
      `alter table "private_lobby" alter column "code_hash" drop not null;`,
    );
    this.addSql(
      `alter table "private_lobby" add constraint "private_lobby_visibility_check" check ("visibility" in ('public', 'private'));`,
    );
    this.addSql(
      `alter table "private_lobby" add constraint "private_lobby_code_visibility_check" check (("visibility" = 'private' and "code_hash" is not null) or ("visibility" = 'public' and "code_hash" is null));`,
    );
    this.addSql(
      `create unique index "private_lobby_created_topic_name_key" on "private_lobby" (lower("name")) where "topic_id" = "id"::text;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "private_lobby_created_topic_name_key";`);
    this.addSql(`delete from "private_lobby" where "visibility" = 'public';`);
    this.addSql(
      `alter table "private_lobby" drop constraint "private_lobby_code_visibility_check";`,
    );
    this.addSql(
      `alter table "private_lobby" drop constraint "private_lobby_visibility_check";`,
    );
    this.addSql(
      `alter table "private_lobby" alter column "code_hash" set not null;`,
    );
    this.addSql(`alter table "private_lobby" drop column "visibility";`);
    this.addSql(`alter table "private_lobby" drop column "name";`);
    this.addSql(`alter table "private_lobby" drop column "side_0";`);
    this.addSql(`alter table "private_lobby" drop column "side_1";`);
  }
}
