import { Migration } from "@mikro-orm/migrations";

export class Migration20261120000000 extends Migration {
  override up(): void {
    this.addSql(
      'alter table "account" add column "reset_hash" char(64) null, add column "reset_expires_at" timestamptz null;',
    );
  }
}
