# Developing in `app/`

How to install, run, test and add to the app in `app/`: the scripts, the ports, fixture mode, the `/dev` portal, conventions for new code, the seams for tests and the end-to-end tests. Read before running, testing or adding to `app/`. The stack and the code layout are in [app-architecture.md](app-architecture.md); puzzle types in [app-games.md](app-games.md); what each check means in [checks.md](checks.md).

## Contents

- **Ports**: the defaults, and why an agent must pass its own.
- **Install**.
- **Running it locally**: `npm run dev`.
- **Scripts**: every `npm run` script.
- **Environment and local state**: `.dev.vars`, `LOCAL_DEV`, `TEST_MODE`, the local D1.
- **Fixture mode**: the client alone, scenarios for screenshots.
- **The /dev portal**: its pages.
- **Conventions**: screens, state, API, strings, look, avatar items, the Worker.
- **Contracts between screens**: navigation state, query strings, test ids.
- **Seams for tests**: scripted fakes of the audio engine, the recorder and the API.
- **End-to-end tests**: running them, the specs, writing one.

## Ports

**Port 8787 is the default dev server's** (`npm run dev` serves there by default; leave it to the person working on the machine). `npm run dev`, `npm run dev:worker` and Playwright's worker target all default to 8787, and `npm run dev:web` proxies the API to 8787, so an agent that runs servers always passes its own ports and state directory (`WEB_PORT=… WORKER_PORT=… PERSIST_DIR=…`, `E2E_META_PORT=…`) and keeps scratch files out of the repo.

| What | Defaults | Override with |
|---|---|---|
| `npm run dev` | client 8787, Worker 8788 (inspector 9788), state `.wrangler/dev-state` | `WEB_PORT`, `WORKER_PORT`, `PERSIST_DIR` |
| `npm run dev:web` | 5173, proxying `/api` and `/gate` to 8787 | `WEB_PORT`, `WORKER_PORT` |
| `npm run dev:worker`, `dev:worker:ai` | 8787, state `.wrangler/state` | `WORKER_PORT`, `PERSIST_DIR` |
| `npm run e2e`, fixture specs | Vite on 5197 | `WEB_PORT` |
| `npm run e2e` with `E2E_TARGET=worker` | 8787, state `.wrangler/state`, builds into `app/dist` | `WORKER_PORT`, `PERSIST_DIR` |
| `*.worker.spec.ts` | 8890 + the Playwright worker's index, inspector +1000; steps past ports in use | `E2E_META_PORT` |

Playwright does not reuse a server already on its port unless `E2E_REUSE_SERVER=1` (another project's Vite on 5173 was once silently reused and every fixture spec failed).

## Install

```sh
cd app
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
cp .dev.vars.example .dev.vars   # once; local secrets, git-ignored
```

- Node 22 or later (`engines` in `package.json`). Use `npm`.
- The install works with npm's `ignore-scripts=true` (a common supply-chain hardening); if a package you add needs its install script, decide that case by case.
- Never run `npm install` while other agents work in `app/`.
- Playwright uses the system Chromium at `/usr/bin/chromium` (override with `CHROMIUM_PATH`), so the install skips Playwright's browser download.

## Running it locally

`npm run dev` (`tools/dev.mjs`) starts the client (Vite with live reload) and the Worker (`wrangler dev`, which Vite proxies `/api` and `/gate` to) behind one URL, with its own D1 state, migrated on start (`dist/` is built once if missing). The Worker runs with `LOCAL_DEV=1` (no gate password, no admin password, localhost only) and `TEST_MODE` off. Its `AI` binding is remote, so speech recognition is the real Workers AI: wrangler must be logged in to your Cloudflare account, and it uses that account's Workers AI quota. Ctrl-C stops both. Pass your own ports (above).

## Scripts

Run in `app/`.

| Script | What it does |
|---|---|
| `npm run dev` | The local development server above. |
| `npm run dev:web` | Vite alone; serves `public/` (the exported `/data` and `/media`) and proxies `/api` and `/gate` to `WORKER_PORT`. With `VITE_FIXTURES=1`: fixture mode. |
| `npm run dev:worker` | `wrangler dev --local`: serves `dist/` and the API with a local D1. Run `npm run build` first. The `AI` binding is unavailable (speech answers "not supported"); use the `TEST_MODE` headers. |
| `npm run dev:worker:ai` | The same without `--local`: the `AI` binding reaches the real Workers AI (uses your account's quota). |
| `npm run db:migrate` | Applies `worker/migrations/` to the local D1 in `PERSIST_DIR`. |
| `npm run build` | Vite build of the client into `dist/`, copying `public/` in. |
| `npm run typecheck` | `tsc` for the web, worker and node configs. |
| `npm test` | Vitest, three projects: `shared` (Node), `web` (happy-dom + Testing Library), `worker` (inside workerd with an isolated D1 per test). One project: `npx vitest run --project shared`. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run check:practices` | Composes and plays practices over the release scenes and checks them (`tools/check-practices.ts`; [checks.md](checks.md)). |
| `npm run check` | typecheck + test + check:practices. Run after changing anything in `app/`; must pass before reporting. |
| `npm run check:liveness` | Plays every puzzle type in the practice screen under scripted outcomes and reports stuck puzzles against the ledger (about 30 s; [checks.md](checks.md), "check:liveness"). Replay one run: `npm run check:liveness -- --type <type> --seed <n> --scenario <s>`. Not in `npm run check`; the pre-commit and Stop hooks run it. |
| `npm run e2e` | Playwright end-to-end tests (below). |
| `npm run screens` | Screenshots of the routes in `e2e/screens.spec.ts` into `test-results/screens/<project>-<name>.png` (`E2E_SHOTS` elsewhere), with its layout checks. Look at them. |

## Environment and local state

- `wrangler.jsonc`: var `TEST_MODE` (empty); bindings `DB`, `AI`, `ASSETS` ([app-release.md](app-release.md)). Secrets `SESSION_SECRET`, `GATE_PASSWORD` and `ADMIN_PASSWORD` are set with `wrangler secret put` in production and in `.dev.vars` locally.
- `.dev.vars` (local, git-ignored, from `.dev.vars.example`): the secrets above, and `TEST_MODE=1` so `dev:worker` and other local runs accept the `x-test-*` headers ([app-server.md](app-server.md)). `npm run dev` turns `TEST_MODE` off and passes `LOCAL_DEV:1` on the command line.
- **`LOCAL_DEV` only ever on the command line**: never in `.dev.vars` (the e2e suite expects the gate on localhost) nor in `wrangler.jsonc` (the release script refuses).
- Worker unit tests get `TEST_MODE=1` and `SESSION_SECRET` from `vitest.config.ts`.
- **Local state.** Local D1 databases live in `app/.wrangler/dev-state` (`npm run dev`), `app/.wrangler/state` (`dev:worker`, `db:migrate`) or your `PERSIST_DIR`. Wrangler records applied migrations by file name, so when migration files are replaced rather than added, delete the local state directory; otherwise the old schema stays.

## Fixture mode

`VITE_FIXTURES=1 npm run dev:web` runs the client alone on an in-memory fixture API (`web/src/api/fixtureClient.ts`) and, when `public/data` is empty, the shared fixture content (`shared/fixtures/`: one real scene, the 203 scene summaries, a player). For UI work and the fixture e2e specs.

- `?flow=<name>` picks a player scenario for Home, the candidates screen and the scene page (`withFlow` in `web/src/api/fixtureClient.ts`): `due` (the default, after a long absence) three due practices, the choose quest locked behind them, one bronze place; `continue` the same with the first one started (12 / 40); `fresh` a brand-new kid (choose and three bronze places); `calm` nothing due (choose and three bronze places); `one` one due practice and the choose quest locked behind it; `mid` mid-day, two of three scenes chosen, the first one's practice half done; `done` every quest done ("Do more"); `more` after "Do more" (its extra quests, a fresh draw of candidates); `all` every scene unlocked (no choose quest). The fixture client's `more()` draws from the fixture index.
- `/?welcome=1` forces the first-open welcome on Home for screenshots.
- **Karaoke recordings** are kept in memory (`karaokeTake` and the rest): a take is checked against `?transcript=` in the page's URL (clean when there is none; `!unavailable` answers 503), a kept recording's audio is an object URL of the uploaded WAV, a retried keep answers the same recording, and a reload forgets it all.

## The /dev portal

An admin, testing and review portal at `/dev`, not linked from the kids' navigation, in plain English. Open under `npm run dev`; behind the admin password in production and on the e2e Worker ([app-server.md](app-server.md)). Files in `web/src/screens/dev/`; shared pieces in `devCompose.ts` and `devParts.tsx`. `e2e/dev.spec.ts` checks every page loads.

| Page | For |
|---|---|
| `/dev` | The index. |
| `/dev/practices` | The practice viewer (`DevPractices.tsx`): any release scene at any level and seed, speaking on or off; the plan as a table (puzzle, target line, units, microphone, why chosen), coverage per line, and the practice played in the real shell from the start or from any row. Progress is kept in this browser only; nothing is posted. `/dev/panono` opens it on the Panono scene. |
| `/dev/types_of_puzzles` | Every registered puzzle type from its `meta`, filterable, each built live on a scene at a chosen level and seed and playable in one tap; when it cannot build, why, and a search for a scene where it does. |
| `/dev/scenes` | All scenes with filters; `?scene=<id>` shows everything the bundle holds for one scene: player, lines and units, alternates with clips, notes, questions with their question and answer clips (the static files the `question` puzzle plays), frames. |
| `/dev/practice` | Plays chosen puzzle types directly in the real shell on a scene, level and seed (the e2e specs use it), or starts a real practice through the API. |
| `/dev/speaking` | Test speech recognition with your own voice; what Whisper heard. |
| `/dev/loops` | Loop styles A to E on real units; D, the chosen one, is starred. |
| `/dev/scene` | The scene components, every effect and sound, the audio engine's state. |
| `/dev/ui`, `/dev/avatar` | The design system; the avatar (`?part=items|icons|base|random`, `?ids=a,b&size=300`). |

## Conventions

- **Imports**: relative paths, no aliases. `shared/` never imports from `web/` or `worker/`.
- **A screen**: routes are declared in `web/src/routes.tsx`, each lazily loading `screens/<Name>.tsx` (default export, params as `params`). `bare: true` routes (practice, chest, login) render without the tab bar and rail. Design for both `useLayout()` values, `phone` (under 768 px, bottom tab bar) and `tablet` (side rail). Add the route to `e2e/screens.spec.ts` and look at both screenshots.
- **State**: the server is the authority. Every mutating API response carries `patch: StatePatch`; apply it with `usePlayer.getState().apply(res.patch)`, never edit `PlayerState` by hand (`applyPatch` in `shared/api.ts` holds the merge rules, shared with the server). Read with selectors.
- **API**: call through `api` from `web/src/api` (the fixture client under `VITE_FIXTURES=1`). A new endpoint needs its types in `shared/api.ts` and a method in `ApiClient`, implemented in both `httpClient` and `fixtureClient`. Errors are `ApiRequestError` with an `ApiErrorCode`.
- **Strings**: every visible string goes through `t('namespace.key', vars)`, with the key in both `shared/i18n/fr.ts` and `en.ts`, in your area's section. Simple, friendly French; tutoyer; a non-breaking space before `! ? : ;`; plurals as `'{n} jour|{n} jours'`. One word per concept in each language: the glossary's (`AGENTS.md`) and the others listed at the top of `shared/i18n/fr.ts` (touche / tap, réplique / line, appareil / device, the comic sound words). Glosses of scene content are data, not strings.
- **A puzzle type**: [app-games.md](app-games.md).
- **Look**: read [app-style.md](app-style.md) before styling anything, and judge screenshots against it.
- **An avatar item**: data in `shared/catalog/items.ts` (ids are stored in inventories: never rename one), art in `web/src/avatar/art/items/<slot>.tsx` drawn on the layers of `art/kit.tsx`. An achievement's reward item names it as its source. Body options in `shared/catalog/avatar.ts`: add, never rename. Check on `/dev/avatar`.
- **Worker**: Hono, `new Hono<AppEnv>()`, area routers mounted in `worker/index.ts`. Unmatched `/api/*` answers 404 JSON; everything else falls through to `ASSETS`.

## Contracts between screens

- **The plan in the navigation state.** Whoever starts a practice (`POST /api/practices/start`) navigates to `/practice/<id>` with `{ state: { plan, fresh: true } }` (`useStartPractice` in `web/src/home/hooks.ts` does it). The practice screen uses a fresh plan once and clears the mark; any other visit (the back button, a reload, a pushed `{ plan }` without `fresh`) asks the server with `{ kind: 'resume', practiceId }`, and a finished practice goes Home with a toast.
- **`/avatar?from=invite`**: the invitation to make an avatar opens the editor with the name field first.
- **Watching a candidate**: `/scene/:id` also opens for one of today's candidates not yet unlocked, with "choose this scene" (`[data-choose]`) and "back to the choice" (`[data-back-to-choice]`) instead of the practice button. Other locked scenes show `[data-scene-page="locked"]`.
- **Test ids on Home, the candidates screen and the scene page**: [app-architecture.md](app-architecture.md), "Home and the daily quests".

## Seams for tests

happy-dom has no Web Audio and no microphone: a real play never ends and `useRecorder` is always `unsupported`. `web/src/testing/fakes.ts` replaces the three modules a puzzle view depends on, with `vi.mock` in the test file (copy the three calls at the top of `web/src/testing/liveness.explore.tsx`): `audio/engine` (the `Engine` class: each play ends after its duration, fails with `onError`, or never ends), `speech/recorder` (`MicRecorder` and `micSupported`: a take with a voice, silent until its limit, a voice that runs to its limit, too short, cut off (an automatic stop with a take too short, as the real recorder does on an interruption), or the microphone failing; granted, denied, missing or the first-time intro) and `api` (`speech` passes, half-heard, missed, 503, 500, offline, slow or hangs; every other call ok, fails or hangs). Before each run, `setScript(script, scenes)`: `fixedScript(seed, { speech: ['unavailable', 'pass'], audio: 'never' })` (a value per channel, or a sequence whose last value repeats) or `randomScript(seed)`. `fakeLog()` lists what was drawn. Use fake timers (`vi.useFakeTimers`); everything waits with `setTimeout`. Call `installFakeAnimate()` too: happy-dom's `Element.animate` finishes on real timers, so under fake timers an awaited animation never ends. No component needs to change for it.

## End-to-end tests

**Running.** `npm run e2e` runs every spec in two projects, `phone` (390×844) and `tablet` (1024×768, landscape), and the layout specs (`screens`, `contrast`, `puzzles`) and the journey in a third, `ipad-portrait` (820×1180, an upright iPad: kids play on iPads both ways up; the list is `IPAD_PORTRAIT_SPECS` in `playwright.config.ts`; the journey adds about 4 minutes), with the system Chromium, a fake microphone that sounds like speech to the client's voice gate (`e2e/fakeVoice.ts`, written to the system temp directory when the config loads; Chromium's own fake beep counts as clicks) and a fake audio output (Web Audio still runs; with the real sound server, closing a context could hang for minutes), all in `playwright.config.ts`. Fixture specs run against Vite with fixtures; each `*.worker.spec.ts` starts its own `wrangler dev --local` per Playwright worker (`e2e/meta-server.ts`): a fresh D1 in a temporary directory, `TEST_MODE` on, `LOCAL_DEV` off, its own admin password, and the client built once per run into a temporary directory (never `app/dist`). From a clean tree it needs nothing else.

- Parallel agents: `WEB_PORT=… E2E_META_PORT=… E2E_OUTPUT_DIR=<scratch>/pw-out npm run e2e` (Playwright wipes its output directory at start, so two runs sharing `test-results/` break each other).
- One spec: `npx playwright test e2e/journey.worker.spec.ts --project=phone`.
- `E2E_BASE_URL` runs against a server you started (Playwright then starts none).
- While other agents edit the tree, Vite's hot reload restarts pages under the fixture specs. Serve a static build instead: `FRX_BUILD=dev NODE_ENV=development VITE_FIXTURES=1 npx vite build --outDir <scratch>/fixdist`, `WORKER_PORT=<a free port of yours> npx vite preview --outDir <scratch>/fixdist --port <port>`, then `E2E_BASE_URL=http://localhost:<port>`. Without `FRX_BUILD=dev` the build has a real build id and asks `/api/build`, and the preview proxies `/api` to `WORKER_PORT`, 8787 by default: the default dev server, or a 502 that fails the specs that watch for failed requests.

**The specs.**

| Spec | Covers |
|---|---|
| `journey.worker.spec.ts` | A kid's whole journey through the daily quests in the real interface: first open, choosing from the choose quest over two visits (the rest into the cauldron), practices from their quest cards across days and devices, a locked choose quest (Home, the candidates screen, `409`), bronze then silver, the full streak, "Do more", a replay, speaking, mute, the hint bubble's rules and the playback bar, every release scene unlocked. Serial within a project. |
| `panono.worker.spec.ts` | A practice on the Panono scene played by taps, speaking on and off, left and continued at the saved puzzle; every line covered by several puzzle types. |
| `speaking.worker.spec.ts` | The speaking panel on the real speech endpoint: pass, miss, third-try pass, recognition unavailable, microphone denied, "Je ne peux pas parler". |
| `karaoke.worker.spec.ts` | Karaoke recordings: the karaoke's own first-time notice and its way back, singing while the song plays once, the check (the song playing on), listening, keeping; the song then plays with the recording after a reload and in Home's card; erasing it after the confirmation; a rude take refused; no voice never sent and the deaf notice after three; a refused or missing microphone (nothing on arrival, nothing logged before a tap); the check failing (no Whisper on the local Worker) and « Réessayer » sending the same singing; leaving without choosing throws it away; 429 and 413 without « Réessayer »; throwing singing away while it is checked; a failed keep and a failed erase; the back button and a history navigation during a take (no live microphone track after); the words being sung in view during a take at six sizes; a take that ends with the song and lands within 50 ms of where it was sung (a digital loopback: the engine's output as the microphone); a recording slow to load (the song does not wait, the stamp does) or missing. Screenshots of every state in `E2E_SHOTS` (default `test-results/karaoke`). |
| `meta.worker.spec.ts` | Chests, names, login, shop, friends, league, language. |
| `errors.worker.spec.ts` | A progress save that fails (route interception): the panel over the continue bar, its detail line, « Réessayer »; a failed load and « Réessayer »; a practice finished in one tab and played on in another ("already saved", the fresh Home, the back button); switching player on a shared device (the player selection: a new player, an empty account deleted and forgotten, back by a tap, a renamed account by name and PIN, removing one); a device that remembers its players but lost its session ("Who's playing?", a tap logs in, no first-open welcome). Screenshots of the panels in `E2E_SHOTS` (default `test-results/errors`). |
| `media.worker.spec.ts` | Loading media: a practice on a throttled connection (the gate fills by bytes, the slow line and its Home button, the first puzzle, clips fetched ahead); a blocked frame (the error panel, its detail, « Réessayer »); a stalled scene audio (the slow line, the error after 25 s, « Réessayer »; a second visit shows no gate); a blocked song (the karaoke's error panel, « Réessayer »); on each error panel, every part reachable and covered by nothing (the sticky action bar, the tab bar); the karaoke gate and Home's card busy while its song loads; a question clip on its way (the loop button busy). Throttling is Chromium's (`Network.emulateNetworkConditions` over CDP); the screen's code and data load first, so the throttle hits the media. Screenshots in `E2E_SHOTS` (default `test-results/media`). |
| `reports.worker.spec.ts` | « Quelque chose ne va pas ? »: the tip under the flag in the first practice, the form from the practice header, « Merci ! », and the report with its context and the kid's activity in the Worker's D1 (read with `wrangler d1 execute --local --persist-to <server.state>`); the tip and a report on the first error panel; the button in the profile. Screenshots in `E2E_SHOTS` (default `test-results/reports`). `newKidPage` marks the tip seen for the other specs. |
| `admin.worker.spec.ts` | `/dev` behind the admin password; the gate alone does not open it. |
| `pwa.worker.spec.ts` | Installability, the build check, `409 client-outdated`, a missing old chunk ([app-release.md](app-release.md)). |
| `puzzles.spec.ts` | Every puzzle type alone on three real scenes at several levels: played to the end with wrong moves, French loops, help strip, layout; screenshots and findings in `E2E_SHOTS`. |
| `new-puzzles.spec.ts` | The six puzzle types added in 2.1 alone; screenshots in `E2E_SHOTS`. |
| `speaking-puzzles.spec.ts` | `act-line`, `say-chain`, `say-choice` with the fixture client and the fake microphone. |
| `contrast.spec.ts` | The colour rule of [app-style.md](app-style.md) on every screen and puzzle type. |
| `screens.spec.ts` | A screenshot of every route, and nothing cut off at the side of the screen once the entrance animations end; the main action on screen on arrival, above the phone's tab bar (the scene page's practice button, Home's next quest, also after "Do more"); on a short phone (375×667), "Do more" on arrival and the first-open welcome scrolling to its button. |
| `dev.spec.ts`, `smoke.spec.ts` | Every `/dev` page loads, the question and answer clips on `/dev/scenes` play; the app boots. |

**Writing a spec.**

- **Worker specs** set the clock with `ctx.setExtraHTTPHeaders({ 'x-test-now': … })`, pass the gate with `POST /gate`, and use `reducedMotion: 'reduce'` so looping animations do not keep buttons "unstable". A spec that opens `/dev` on the worker signs in once with `signInAdmin(ctx, server)`. Speech is scored on the `x-test-transcript` header (the puzzle's own French to pass, nonsense to fail, none for 503); `x-test-judge` gives the judge's answer (`real` asks the real judge; [app-server.md](app-server.md) has the headers).
- **Driving puzzles like a kid**: `test.use({ devBuild: true })` serves a development build, in which the practice shell publishes the running puzzle on `window.__frxPractice` (its state, `solve()` for the perfect next action and `wrong()` when the puzzle type has a `wrongAction`). `e2e/drive.ts` maps the action to what a kid would tap (`tapsFor`) and taps it; it never dispatches. A new puzzle type needs one `case` in `tapsFor`. `window.__frxAudio` exposes the audio engine for loop checks.
- **A new kid's first open** asks "Déjà un compte ?" (`[data-testid="pwa-welcome"]` with `data-welcome-where` `browser` or `app`, answered with `[data-welcome-new]` or `[data-welcome-login]`; "Qui joue ?" with `[data-player]` tiles when the device remembers other accounts in `frx.accounts`) before the welcome (`[data-testid="welcome"]`, `[data-welcome-go]`). `newKidPage` answers it in its init script (`frx.pwa.welcomeBack`); a spec with its own context sets that flag too, or taps the answer.
- **A save to hold or fail**: `page.route(/\/api\/practices\/[^/]+\/progress$/, …)` and `playPuzzle(kid, { leaveDone: true })`, which leaves the puzzle done with its continue bar showing (`errors.worker.spec.ts`). A dev build runs every load twice (StrictMode): fail every try until the test lets them through, not only the first.
- **Never find an element by its text.** The wording is the dictionaries' (`shared/i18n/`) and changes; a locator on copy breaks with it. Use a `data-*` attribute or test id (add one to the component when missing); when the check is about the words themselves, compare with `translate('fr', key, vars)` from `shared/i18n` (the e2e kids play in French, `x-test-language: fr`). Hooks added for this: `[data-home-hello]`, `[data-due-count]`, `[data-cauldron-note]`, `[data-chest-open]`, `[data-chest-continue]`, `[data-nav="/…"]` on the tab bar and rail, `[data-option]` on the profile's toggles, `[data-name-change]`, `[data-name-save]`, `[data-name-problem]` (the check's reason or the server's code), `[data-login-error]` (`stale`, `rate-limited`, `bad-credentials`), `[data-testid="shop"]`, `[data-item]`, `[data-buy]`, `[data-tab]`, `[data-friend-search]`, `[data-follow]` (`follow`, `following`), `[data-cheer]`, `[data-inbox]` (the gift's kind), `[data-tier]` and `[data-me]` on the league, `[data-version]`, `[data-empty-go]`, `[data-today]` on a day of the collection, `data-level` on a collection scene, `data-to-win` on the scene page's `[data-worth]`, and a toast's tag (`toast(text, { tag })` renders `[data-toast="<tag>"]`: `bought`, `sent`, `practice-closed`, `report-thanks`).
- **A unique account name** is a word plus `nameSuffix()` (`e2e/meta-server.ts`: the clock as consonants), never digits: the name filter reads digits as letters (8 is b, 0 is o), so a name like `Gaulois808` is refused now and then and the spec flakes.
- **Tap something inert** when a check needs a "tap elsewhere" (the `h1` on the scene page, the progress bar in a practice): tapping a back button or thumbnail under a shifted layout navigated away mid-journey.
- **A microphone that hears nothing**: an init script that replaces `navigator.mediaDevices.getUserMedia` with `async () => new AudioContext().createMediaStreamDestination().stream` (`karaoke.worker.spec.ts`, `watchMic`, which also counts the live tracks); one that rejects with a `NotAllowedError` is a refused microphone; `navigator.mediaDevices` undefined is a browser without one. `?transcript=` can be changed mid-test with `history.replaceState`: the client reads it at each send. In dev builds `window.__frxLog()` returns the client's last logged events (`web/src/log`).
- **Wait on a condition, not a pause**: before a screenshot or a layout measurement, `settled(page)` (`e2e/drive.ts`) waits for the fonts, the images on screen and every animation that ends (entrances, slam-ins, pops; looping ones are left out).
- **Traces** are off in the long specs: the scene player re-renders on every audio frame, and writing a long round's trace took minutes.
