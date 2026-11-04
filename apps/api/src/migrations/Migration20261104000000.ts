import { Migration } from "@mikro-orm/migrations";

// The feature branch originally used staging's tags migration ID for voting.
// Reconcile either previously applied version before proceeding.
export class Migration20261104000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "private_lobby" add column if not exists "voting" jsonb null;',
    );
    this.addSql(
      'alter table "public_lobby_state" add column if not exists "voting" jsonb null;',
    );
    this.addSql(
      `alter table "private_lobby" add column if not exists "tags" text[] not null default '{}';`,
    );
    this.addSql(`do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'private_lobby_tags_check' and conrelid = 'private_lobby'::regclass) then
        alter table "private_lobby" add constraint "private_lobby_tags_check" check ("tags" <@ array['Casual', 'Serious', 'Beginner-friendly', 'Competitive', 'Educational', 'Open-minded']::text[]);
      end if;
    end $$;`);
  }
  override async down(): Promise<void> {
    this.addSql('alter table "private_lobby" drop column "voting";');
    this.addSql('alter table "public_lobby_state" drop column "voting";');
  }
}
