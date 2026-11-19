D1 migrations, applied in name order by `wrangler d1 migrations apply DB` (locally: `npm run db:migrate`). Name them `NNNN_what.sql`; never edit one that has been applied in production, add a new one.
 Add each new migration to the list in `worker/testing.ts` too (the worker tests apply them from there).
