import { Migration } from "@mikro-orm/migrations";

export class Migration20261006194002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "account" (
        "id" uuid not null,
        "username" text not null,
        "username_key" text not null,
        "email" text not null,
        "password_hash" text not null,
        "created_at" timestamptz not null default now(),
        primary key ("id")
      );
    `);
    this.addSql(
      'alter table "account" add constraint "account_username_key_key" unique ("username_key");',
    );
    this.addSql(
      'alter table "account" add constraint "account_email_key" unique ("email");',
    );
    this.addSql(`
      create table "account_session" (
        "token_hash" char(64) not null,
        "account_id" uuid not null,
        "expires_at" timestamptz not null,
        primary key ("token_hash")
      );
    `);
    this.addSql(
      'create index "account_session_expires_at_idx" on "account_session" ("expires_at");',
    );
    this.addSql(
      'alter table "account_session" add constraint "account_session_account_id_foreign" foreign key ("account_id") references "account" ("id") on delete cascade;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "account_session" cascade;');
    this.addSql('drop table if exists "account" cascade;');
  }
}
