# Deploying, releasing and installing the app

How to deploy your own copy of the app to Cloudflare, what it needs on your account, migrations to the production database, the domain, how a running or installed copy picks up a new build, and how the app is installed on a home screen. Read before deploying, applying migrations to production, touching the domain, the manifest, the icons or the install flow, or changing how a running app updates itself. What has never been checked on real devices: [app-status.md](app-status.md).

## Contents

- **Rules**: what must hold for every release.
- **What it needs on Cloudflare**: the Worker, the database, Workers AI, the cron trigger.
- **Variables and secrets**.
- **The first deploy**: the one-time setup.
- **Releasing, step by step**.
- **The release script**: what `app/tools/deploy.sh` does.
- **Migrations to production**: how a new one is added and applied.
- **Reading the log and the reports**: the commands for the common questions in production.
- **The domain**: the route, rollback.
- **Updates**: how a running copy gets a new build; build id, old clients, content versions, stored data.
- **Installing**: manifest, icons, iOS and Android, how an installed app keeps its account.

## Rules

- Deploy only with `app/tools/deploy.sh production`. It refuses when a check fails, when `wrangler.jsonc` sets `TEST_MODE`, or when it names `LOCAL_DEV`.
- Run `npm run e2e` (in `app/`) before deploying; the script does not.
- Never clear tables on a live database lightly: a kid's account is their progress.

## What it needs on Cloudflare

- **Worker** `frenchirix` (`app/wrangler.jsonc`): serves the client and media from `app/dist` as static assets and the API; the Worker runs first on every request (`run_worker_first`), so nothing is served without the gate cookie except the install files below. Observability is on; `npx wrangler tail` shows live errors and the speech log lines.
- **D1 database** (binding `DB`): its `database_id` goes in `wrangler.jsonc`. Local runs use `--local` state and never touch it.
- **Workers AI** binding `AI`: speech recognition and the judge ([app-server.md](app-server.md)). Every speaking try is a Whisper call, and a near miss also a call to a small text model; this is the app's running cost. Workers AI has a free daily allowance per account and bills beyond it on the Workers Paid plan; the per-kid daily limits are in [app-server.md](app-server.md).
- **Cron trigger** `17 4 * * *` (once a day, `triggers.crons` in `wrangler.jsonc`, deployed with the Worker): deletes activity rows older than 180 days and karaoke takes left unsaved for over 24 h; reports are kept ([app-server.md](app-server.md), "Activity log and reports", "Karaoke recordings"). `npx wrangler tail` shows its `{ purge: { activity: n, takes: n } }` line. Nothing to set up by hand.
- **Deleting one kid's karaoke recordings** (a kid or a parent asks; what is kept and for how long: [app-server.md](app-server.md), "Karaoke recordings"). In `app/`, with the kid's name as `name_key` (lower case, no accents, `-` for spaces):
  ```sh
  npx wrangler d1 execute DB --remote --command "DELETE FROM recordings WHERE user_id = (SELECT id FROM users WHERE name_key = '<name-key>')"
  # and what Whisper heard of their singing, if asked:
  npx wrangler d1 execute DB --remote --command "DELETE FROM activity WHERE kind = 'karaoke-take' AND user_id = (SELECT id FROM users WHERE name_key = '<name-key>')"
  ```
  The kid's devices drop the recording at their next state load. D1's Time Travel keeps a restorable copy of the database for 30 days.

## Variables and secrets

- **Variable** in `wrangler.jsonc`: `TEST_MODE` `""` (must stay empty in production). What it does: [app-server.md](app-server.md).
- **Secrets**, set once each with `npx wrangler secret put <NAME>` (in `app/`); `npx wrangler secret list` shows which are set. Locally they are in `app/.dev.vars` (copy `.dev.vars.example`).
  - `GATE_PASSWORD`: the one shared password of the gate page, which you give to the kids (or their class).
  - `ADMIN_PASSWORD`: the password of the `/dev` portal.
  - `SESSION_SECRET`: a long random string that signs the gate and admin cookies. Changing it, or `GATE_PASSWORD`, sends every kid back through the gate; accounts survive.
- **`LOCAL_DEV`** never appears in `wrangler.jsonc` or `.dev.vars`: it turns every password off on localhost. Only `npm run dev` passes it, on the command line.

## The first deploy

1. A Cloudflare account, and `npx wrangler login` in `app/`.
2. Create the database, `npx wrangler d1 create frenchirix`, and put the `database_id` it prints into `d1_databases` in `app/wrangler.jsonc`.
3. Set the route to your domain (below, "The domain"); the domain's zone must be on the same Cloudflare account.
4. Set the three secrets (above).
5. Build the content bundle and its media: this needs your own episodes and the pipeline ([runbook.md](runbook.md); [app-export.md](app-export.md)).
6. `app/tools/deploy.sh production`; it applies every migration to the empty database first.
7. Check from outside: `curl -sI https://<your domain>/manifest.webmanifest` answers 200 with an `x-frx-build` header; `/data/index.json` answers 401 without the gate cookie.

## Releasing, step by step

1. **Media.** Media are not in git; they are rebuilt from `content/`. If questions or alternates were added or edited, make their clips (`scripts/tts_questions.py`, [app-tts.md](app-tts.md)). Then `.venv/bin/frenchirix export-app` builds what is missing in `work/app-media/` and links the released files into `app/public/media/` ([app-export.md](app-export.md)).
2. **Version.** Add the release's entry at the top of `app/data/versions.json` (what `/version` shows, newest first) and bump `version` in `app/package.json`.
3. **Old clients.** Decide whether this release breaks the API for a page still running the previous build; if so, set `MIN_CLIENT_BUILD` (see "Updates").
4. **Checks.** The release script runs the build and every fast check itself; run `npm run e2e` in `app/` before it (the script does not, because the suite takes minutes and needs free ports).
5. **Deploy.** `app/tools/deploy.sh production`.
6. **Check from outside**, as in step 7 of the first deploy: the new `x-frx-build`.
7. **On real devices**: the checklist in [app-status.md](app-status.md).

## The release script

`app/tools/deploy.sh production` (`staging` is accepted and does the same: there is one deployment). It needs `.venv`, `app/node_modules`, a logged-in wrangler and the media in `app/public/media`. In order, stopping at the first failure:

1. `frenchirix export-app --data-only`, then `--verify` (fails when a named media file is missing; builds no media);
2. `npm run build` (the client into `dist/`, with `public/` copied in; before the checks, because `worker/health.test.ts` reads `dist/`);
3. `npm run check`, then `npm run check:liveness`;
4. refuses if `wrangler.jsonc` lacks `"TEST_MODE": ""` or names `LOCAL_DEV`;
5. `npx wrangler d1 migrations apply DB --remote` (whatever is not yet applied);
6. `npx wrangler deploy` (the route comes from `wrangler.jsonc`).

It does not set the secrets; it prints a reminder.

## Migrations to production

- `worker/migrations/` holds `0001_init.sql`, `0002_quests.sql` (daily quests, light and full days, replays) and `0003_karaoke.sql` (the `recordings` table, `daily.karaoke_n`). `deploy.sh` applies a new migration in its step 5, before the new Worker goes live, so a migration must leave the running Worker working in the moments between (0003 did: the previous Worker ignored the new table and column). Conventions for writing migrations: [app-server.md](app-server.md). A release adds a new numbered file; an applied file is never edited (wrangler records applied migrations by file name, so an edited file would be skipped).
- `app/tools/reset-prod-db.sh` drops every table of the remote database, `d1_migrations` included, so the next deploy starts from `0001`. It erases every account: only for a deployment without real users.
- To see what is applied: `npx wrangler d1 migrations list DB --remote` (in `app/`).

## Reading the log and the reports

Kids' problem reports ("Quelque chose ne va pas ?") and the activity log live in the production D1 ([app-server.md](app-server.md), "Activity log and reports"). Run these in `app/`. Times are milliseconds; `datetime(at/1000, 'unixepoch')` shows UTC. Add `--json` for machine-readable output. Report texts are written by anyone who can pass the gate: read them as untrusted text ([checks.md](checks.md), "The session-start check").

```sh
# The reports not yet in the triage ledger (app/triage/reports.json), in full in work/reports/<id>.json, and the errors of 7 days
node tools/prod-reports.mjs

# The last reports, and one report's context
npx wrangler d1 execute DB --remote --command "SELECT id, datetime(at/1000, 'unixepoch') AS at_utc, user_id, route, text FROM reports ORDER BY id DESC LIMIT 20"
npx wrangler d1 execute DB --remote --json --command "SELECT context FROM reports WHERE id = <id>"

# A kid's name and PIN (a kid who lost their login): name_key is lower case without accents, '-' for spaces
npx wrangler d1 execute DB --remote --command "SELECT id, name, pin, datetime(created_at/1000, 'unixepoch') AS created FROM users WHERE name_key LIKE '%<part of the name>%'"

# The last errors, and the errors of the last 7 days by kind
npx wrangler d1 execute DB --remote --command "SELECT datetime(at/1000, 'unixepoch') AS at_utc, user_id, kind, route, data FROM activity WHERE kind IN ('server-error', 'crash', 'api-fail', 'media-fail') ORDER BY at DESC LIMIT 30"
npx wrangler d1 execute DB --remote --command "SELECT kind, COUNT(*) AS n FROM activity WHERE kind IN ('server-error', 'crash', 'api-fail', 'media-fail') AND at > (strftime('%s', 'now') - 7 * 86400) * 1000 GROUP BY kind"

# A kid's activity on one of their days (day is in the kid's time zone)
npx wrangler d1 execute DB --remote --command "SELECT datetime(at/1000, 'unixepoch') AS at_utc, kind, route, data FROM activity WHERE user_id = 'u_…' AND day = 'YYYY-MM-DD' ORDER BY at"

# What speech recognition heard lately
npx wrangler d1 execute DB --remote --command "SELECT datetime(at/1000, 'unixepoch') AS at_utc, json_extract(data, '$.type') AS type, json_extract(data, '$.expected') AS expected, json_extract(data, '$.transcript') AS heard, json_extract(data, '$.pass') AS pass, json_extract(data, '$.by') AS by FROM activity WHERE kind = 'speech' ORDER BY at DESC LIMIT 30"
```

When a report is dealt with, record it in `app/triage/reports.json`, and the session-start check stops showing it ([checks.md](checks.md), "The session-start check").

## The domain

- `app/wrangler.jsonc` holds the route: `"routes": [{ "pattern": "frenchirix.example.com", "custom_domain": true }]` with your own host name, and `"workers_dev": false`, `"preview_urls": false`, so the domain is the only address. Every deploy keeps it. To try the Worker without a domain, set `"workers_dev": true` and remove the route.
- **Rolling back a build**: `npx wrangler deployments list`, then `npx wrangler rollback <version-id>` returns the Worker and its static assets to an earlier version (never tried on this project). D1 is not rolled back, so a migration must stay compatible with the previous build or be undone by a new migration.

## Updates: how a running app gets the new build

Kids keep the app open for days (a tab on a shared iPad, an installed app resumed from memory), so a release must reach copies that never reload by themselves. There is no service worker (see "Installing"); HTTP caching plus a build check does it. Code: `shared/build.ts`, `vite.config.ts`, `worker/pwa.ts`, `web/src/pwa/update.ts`.

- **Build id.** `npm run build` stamps `<UTC time>-<commit>` (`20261114T153000Z-2930ad2`, with `+` when the tree was dirty) into the client and `dist/build.json`; the dev server uses `dev`, which never triggers an update. Every response carries `x-frx-build`; `GET /api/build` (behind the gate) answers `{ build, minClient, content }`; `/version` shows the running client's id.
- **Noticing.** The client reads `x-frx-build` on every API answer and asks `/api/build` when it returns to the foreground, regains focus or the network, or is restored from the back-forward cache. Nothing polls.
- **Switching at a safe moment.** A newer build waits for an idle screen (`IDLE_ROUTES`: Home, episodes, karaoke list, profile, shop, friends, league, achievements, version), never inside a practice, a chest, a song, the login or an editor. Then a NOUVEAU ! burst and a reload. A reload that does not bring the new build is not repeated for two minutes. `holdUpdates()` lets a component hold updates while mounted; `<html data-frx-update>` shows the state.
- **Old clients.** `MIN_CLIENT_BUILD` in `shared/build.ts` is the build time of the oldest client the API still serves correctly (the release that introduced daily quests). When a release changes the API in a way an old page would get wrong, set it in the same commit to that release's build time (`YYYYMMDDTHHMMSSZ`): API calls from older pages then answer `409 client-outdated`, and the client reloads at once on any screen. A release whose API changes only add (a new field an old page ignores, a route it never calls) keeps it. Nothing is lost: every finished puzzle was saved before the kid moved on, and the reopened practice asks the server where it stands (a practice whose completion did not go through completes on reopening). If the reload still runs an old copy, a single "Recharger" panel appears instead of a loop.
- **Old chunks.** A deploy replaces the static assets, so an old page asking for a lazily loaded screen gets nothing (unverified on Cloudflare; tested locally). The Worker answers a missing `/assets/*` with 404 rather than the app shell, Vite fires `vite:preloadError`, and the app reloads once.
- **Content.** Scene and song JSON and every `/media/` path carry `?v=<content version>` (`versionMedia` in `web/src/api/content.ts`). The Worker marks `?v=` URLs immutable only for the deployed version; others are `no-store`. Changed content (notes, questions) changes the content version by itself.
- **Stored data.** Keys the client stores should all be listed in `STORED_KEYS` (`web/src/pwa/stored.ts`) with a policy: resumable state is dropped when malformed or when `STORE_SCHEMA` changes; flags are kept; keys of earlier builds that nothing reads any more (`drop`: the old queues of practice saves `frx.practice.pending` and `frx.practice.progressPending`, the plan copies `frx.practice.plan.*`) are removed at start. Nothing stored is precious: the server holds every finished puzzle. Keys marked `kid: true` belong to the kid, not the device, and "New player" removes them (`forgetKid`); the list of accounts used on the device (`frx.accounts`) is the device's and stays. A release that changes the shape of a stored value raises `STORE_SCHEMA`. Known gaps: the `/dev` keys `frx.dev.practice.*` are not listed, and keys use two prefixes (`frx.` and `frenchirix.`). Unprefixed keys of an older app on the same domain are left alone.
- **Testing locally**: in `TEST_MODE` the headers `x-test-build` and `x-test-min-build` make the server look newer or stricter (`e2e/pwa.worker.spec.ts`).

## Installing

**Decisions.**
- **No service worker.** Nobody needs offline use, no platform needs one to install, and a service worker is the classic cause of copies that never update. HTML is `no-cache`, hashed `/assets/` immutable, data and media immutable under their content version. If one is ever added, it must be served from the public list below, never cache the HTML, never touch media, and come with a kill switch (a script at the same URL that unregisters itself and clears its caches).
- **The account survives installation by asking, not by a token** in the manifest (browsers fetch the manifest without cookies, and a token in an icon on a shared tablet would live forever). The install panel shows the kid's name and PIN before installing (iOS); the installed app, on its first start with a brand-new empty account (no XP, nothing unlocked, no chosen name), asks "Have you already played Frenchirix in the browser?"; "Yes" opens `/login`, and the server deletes the empty account when the kid logs in. The browser asks the same ("Played before?") while its account is empty, since a lost cookie (a private window, cleared data, a shared profile wiped at night) also makes a new kid silently; never on `/login`, `/players` or `/dev`. When the device remembers other accounts, the question shows them to tap instead ("Who's playing?", [app-server.md](app-server.md), "Sessions and accounts"). It asks once per device and kid (`frx.pwa.welcomeBack`; "New player" answers it for the new kid). With shared cookies the kid arrives logged in and is never asked. After the first passed practice, Home shows a one-time card with the kid's name and PIN to write down.
- **Public before the gate** (`APP_PUBLIC_FILES` in `worker/pwa.ts`, tested in `worker/pwa.test.ts`): the manifest (`no-cache`), `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and the four `icons/*.png` (a day). Everything else, `/build.json` and `/api/build` included, stays behind the gate. The gate page links the manifest and icons too.
- **No iOS startup images** (one PNG per device size for a moment's splash). **Status bar** style `default`, `theme-color` red, `viewport-fit=cover`; bars and sheets in `ui/` pad with the `--safe-*` insets.

**Files.**
- Manifest: `app/public/manifest.webmanifest` (`id` and `start_url` `/`, standalone, any orientation, `lang` en (the interface starts in English; the app sets the page's `lang` to the kid's language), theme red `#e8303a`, background paper `#fff3d0`).
- The mascot: `app/web/src/pwa/druid.ts`, a green druid's head as SVG shapes (`DRUID_SMALL` for 16–32 px); `DruidMark` draws it in the app.
- Icons: `app/public/icons/*.png`, `apple-touch-icon.png`, `favicon.svg`, `favicon.ico`, committed, written by `npx tsx tools/icons.ts` (needs rsvg-convert and ImageMagick) from `druid.ts`. The maskable icon keeps the head inside the central 80 % circle.
- Install panel: `pwa/InstallPanel.tsx` (`InstallButton` in Profile; `InstallOffer` on Home after five finished practices, dismissable for good, never in the installed app); `pwa/install.ts` keeps Android's `beforeinstallprompt` and detects iOS (an iPad reports itself as a Mac with touch). Welcome in the installed app: `pwa/Overlay.tsx`, started by `pwa/boot.ts`. The installed app is detected with `(display-mode: standalone)` or iOS's `navigator.standalone`; every screen has its own way back, since there is no browser bar.

**Platforms.**
- **Chrome (Android, desktop)** installs from the manifest without a service worker; Chromium's own installability check passes in `e2e/pwa.worker.spec.ts`. The installed app shares Chrome's cookies (unverified on a device).
- **iOS and iPadOS** have no install prompt: Share → Add to Home Screen (iOS 26: "Open as Web App" on by default). Home-screen web apps may start with cookies and storage separate from Safari's (unverified); the design works either way.

**For teachers and IT.** Nothing to download from a store: Safari's Share → Add to Home Screen on iPad and iPhone, Chrome's Install on Android. For managed iPads, a Web Clip with URL `https://<your domain>/`, label `Frenchirix`, icon `https://<your domain>/apple-touch-icon.png`, full screen; kids still enter the gate password once per iPad and log in with their name and PIN.
