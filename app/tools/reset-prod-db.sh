#!/bin/sh
# Empty the production D1 database, once, before the first deploy of a schema that replaces the old
# migration files (release 2.2: one new 0001_init.sql). Wrangler records applied migrations by file
# name in d1_migrations; on the old database the new 0001_init.sql would count as applied and be
# skipped. This drops every table, d1_migrations included; tools/deploy.sh then applies the schema.
#
#   app/tools/reset-prod-db.sh        asks you to type "reset", then drops everything
#
# Only for a database without real users (the user confirmed this for 2.2 on 2026-11-14): every
# account, progress row, log and report is deleted. Needs a logged-in wrangler. docs/app-release.md,
# "Migrations to production".
set -eu
cd "$(dirname "$0")/.."

echo "Tables in the production database now:"
tables=$(npx wrangler d1 execute DB --remote --json --command \
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log((r[0]?.results??[]).map(x=>x.name).join(" "))})')
if [ -z "$tables" ]; then
  echo "  (none): nothing to drop."
  exit 0
fi
for t in $tables; do echo "  $t"; done
printf 'This deletes all of them and everything in them. Type "reset" to go on: '
read -r answer
[ "$answer" = "reset" ] || { echo "Stopped; nothing was changed."; exit 1; }

sql="PRAGMA defer_foreign_keys = true;"
for t in $tables; do sql="$sql DROP TABLE IF EXISTS \"$t\";"; done
npx wrangler d1 execute DB --remote --command "$sql"
echo "Done. Next: app/tools/deploy.sh production (it applies worker/migrations/0001_init.sql)."
