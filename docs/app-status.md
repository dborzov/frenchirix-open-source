# Known rough edges and unverified areas

What has never been verified on a real device or by ear, the known rough edges of the code, the open items left in it, and suggestions not built. Read first when picking up work on the app, and before relying on any of the behaviours below; then [intent.md](intent.md) for what the app is meant to do. This file holds the one checklist of unverified device and listening checks; other docs link here.

## Contents

- **Never verified: the checklist**: real devices, installing and updates, by ear, errors and accounts, load and cost.
- **Known rough edges**.
- **Open items in the code**.
- **Suggested, not built**.

## Never verified: the checklist

The end-to-end tests run headless desktop Chromium, which emulates neither iOS nor hearing. Nothing below was confirmed on a real device or by a human ear when this repository was published; check what matters for your deployment.

**A deployment**
- [ ] `/dev` asks for the admin password once, then opens.
- [ ] Media answers carry `Content-Length` (and no `Content-Encoding`) behind the gate cookie, so the loading gate's bar counts bytes, not files: `curl -sI` a scene's audio (`/media/a/…?v=…`) with the cookie. Only the local Worker was checked.
- [ ] Karaoke recordings on production D1: record the longest song in full (a take of about a minute is three rows of up to 900,000 characters), keep it, reload the song, and hear the voice with it. That proves D1 accepts the chunk rows and serves them back (D1's 100 KB limit is on the SQL text, its 2 MB on a row).

**A real iPad and a real phone**
- [ ] A whole first practice with sound: the `place-words` opener, a loop of a short phrase, the hint bubble, the playback bar, mute.
- [ ] The microphone (an AudioWorklet recorder): a pass, a miss, the third try accepted, "Je ne peux pas parler"; `say-choice` and `say-chain`.
- [ ] The microphone control ([app-games.md](app-games.md), "Speaking puzzles"), in every speaking puzzle type: the meter moves with the kid's voice (green bars on a voice, the halo growing), the countdown runs out at 10 s and the take is checked, Pause and « Continuer », a phone call or the screen locked mid-take (the take ends; `say-chain` pauses), the microphone indicator of the device off whenever the control is not listening.
- [ ] The voice gate on real voices and rooms: a quiet child, a child far from the iPad, a noisy classroom, a deep adult voice: none dropped as « Je n'ai rien entendu ». A muted microphone (or one another app holds) reaches « Je n'entends pas ton micro » after three takes.
- [ ] iOS hands-free `say-chain`: the microphone of the items after the first opens without a tap (its AudioContext is created outside a gesture; the capture should let it start). If those takes come back silent on an iPad, the chain stops at « Je n'ai rien entendu » and a tap goes on.
- [ ] Speech recognition and the judge on real children's voices (measured only on actors' lines, silence, noise and must-fail clips).
- [ ] A chest; karaoke; leaving a practice and continuing it, also on another device.
- [ ] Notes: a long note (about 470 characters) scrolls inside its bubble by touch on a phone without the bubble closing; a scene with many asterisks still reads well at a glance.
- [ ] iOS: the silent switch does not mute the app (the engine sets `navigator.audioSession.type = 'playback'` where the API exists).
- [ ] iOS Safari's `decodeAudioData` honours the AAC edit list of the scene audio; if not, everything plays 21 ms late ([app-export.md](app-export.md), "Audio").
- [ ] The WebP slideshow frames display on old iPads.
- [ ] Karaoke recordings ([app-games.md](app-games.md), "Karaoke: singing along with the microphone"), on an iPad (both ways up) and an iPhone (Safari and the installed app) and an Android phone: the karaoke's first-time notice, then the browser's own microphone prompt (iOS asks inside the tap on « D'accord ! »); the words being sung stay in view during the whole take; the song keeps playing, audibly and through the speaker (not the earpiece), when the microphone opens (the audio session turns to play-and-record; iOS may interrupt or quieten the song's context, or route it to the receiver); the meter moves with singing; the take ends at the song's end; the device's microphone indicator goes off after it; a phone call or the screen locked mid-take drops it.
- [ ] Karaoke, by ear: the voice sits on the song where it was sung, without and with Bluetooth headphones (measured within 25 ms only in a digital loopback in Chromium; on a device the voice lands late by whatever latency the browser does not report, and Safari reports no input latency); the voice is loud enough over the song (it plays at its recorded level, gain 1); a recording made on an iPad plays on a phone and the other way round.
- [ ] Karaoke without headphones: a kid who stays silent while the song plays from the speaker gets « On ne t'a pas entendu chanter ! », or a take that is the song's echo (the voice gate was tuned on speech, not on music behind echo cancellation); a kid who sings is never told nobody sang.
- [ ] The media gate on a real slow phone connection (mobile data with one bar, a busy Wi-Fi): the bar moves with what arrives, the "slow connection" line and its Home button, the error panel and « Réessayer » when the connection drops, and a cached scene opening with no flash of the gate. Only Chromium's emulated throttling was tested.
- [ ] Home, the candidates screen and the scene page, both orientations: the scene page's action is a sticky bar at the bottom on an iPad too, two rows at most (does it hide too much of the strip upright?); the scene page follows the playing line only after a touch, one line at a time (a kid who never touches it may not see that the strip goes on below the fold); Home scrolls its next quest into view when it is below the fold.

**Installing and updates** ([app-release.md](app-release.md), "Installing")
- [ ] iPad Safari: the install panel's steps match what Safari shows (iPadOS and iOS 26, French and English labels); the home-screen icon is the druid, titled "Frenchirix".
- [ ] The installed app on iOS: does it ask for the gate password again (separate cookies) or not? Either way, "Oui" on the welcome, then name and PIN, brings the account back.
- [ ] The installed app on iPad and iPhone: the top bar clears the status bar and notch, the tab bar the home indicator; both orientations on iPad.
- [ ] Android Chrome: Profile → "Installer l'appli" opens Chrome's install dialog; the installed app opens logged in, without the welcome question.
- [ ] An update reaching an installed app: leave it in the background, deploy, bring it back on Home: NOUVEAU ! then the new build (`/version` shows it). Inside a practice nothing happens until it ends.
- [ ] After a deploy, a page of the previous build asking for a lazily loaded screen gets a 404 and reloads once (tested locally only).

**By ear**
- [ ] The scene audio after loudness levelling (−16 LUFS with a limiter).
- [ ] The lines with estimated word timings (`approxTimes`; `.venv/bin/frenchirix export-app --verbose` lists them): their unit loops may play the wrong sound.
- [ ] The generated question, answer and alternate clips: listen to a sample before trusting them ([app-tts.md](app-tts.md), "How each clip is checked").
- [ ] Line alternates written by an LLM: read a sample, especially invented words, very short originals (whose alternates are thin) and long originals trimmed to 14 words.

**Errors and accounts**
- [ ] The error panel's copy button on an iPad and a phone (Safari may refuse the clipboard; the line is then selected for copying by hand).
- [ ] Switching players on a shared iPad: two kids switching back and forth from the profile's "Switch player" with one tap each, "New player", removing an account; then the same iPad after a few days unused (Safari may clear `localStorage`: the list is gone, name and PIN still work).
- [ ] The gate page on a real iPad and phone, both orientations, with the on-screen keyboard up: the field stays visible ([app-server.md](app-server.md), "Gate and `/dev` admin").

**Load and cost**
- [ ] D1 load of the per-puzzle progress saves.
- [ ] Workers AI use of speech recognition and the judge under real classroom use, against your account's daily allowance ([app-release.md](app-release.md), "What it needs on Cloudflare").
- [ ] Karaoke: how long a take's write and its three reads take on production D1; Whisper on children singing over music (only generated speech over music and the song itself were tried) and on rude words sung (none tried).

## Known rough edges

- `say-chain` with every word missed is long: up to six words, three tries each, each with the model, the take and recognition (`check:liveness` measures 60 to 80 s for chains with many misses).
- A slow reader may not finish the longest lines (20 words or more) within the 10 s a take lasts; the take is checked as it is and the words heard stay lit, so the next try finishes the line.
- On a 390×844 phone, when all three of `say-choice`'s balloons are long lines, the first row of the first balloon scrolls away while the kid speaks (the balloons' buttons step aside while listening, so short and middling lines fit).
- A speech request that times out or fails recognition shows the same listen-back round as the daily speech limit, so a kid (or a tester) cannot tell them apart.
- While the media gate is up on the scene page, the action (start the practice, choose the scene) is in the page under the gate, below the fold on a phone, and becomes the sticky bar once the media are in.
- A failed fetch ahead of a practice's clips is silent; the play loads the clip again and says so if it fails then.
- `composePractice` ignores the weak units the server sends (`focusUnitIds`): weak spots are recorded but steer no puzzle.
- On an upright 768×1024 iPad the puzzle's title tag hides under the scene pane once the pane scrolls (a fix needs room reserved above the content); in `act-line` on a phone, « Rejouer la scène » can sit behind the docked microphone until the kid scrolls.
- Two whole lines close in meaning may still stand side by side in `listen-pick` (the whole-line rule allows half the content words shared). At bronze only `listen-pick` and `question` serve the meaning angle, so long scenes lean on them.
- Karaoke: a check the kid abandons still runs on the server and counts toward the daily cap; an upload that commits after the kid's "throw away" stays as an unsaved take until the next take or the purge (up to about 48 h); the word check can refuse a name or a foreign word that only looks rude; at 375×667 only the top edge of the record control shows on arrival.

## Open items in the code

- **A retired word left in a name**: the `question` puzzle type's host is still named `QuizDruid` and its show « le quiz du druide » ("quiz" is a retired word for a puzzle; here it is the name of the show).
- **Interface text**: the version notes (`data/versions.json`) are English only and show in the French interface too; the catalog's texts (item names and jokes, achievements, cheers in `shared/catalog/`) are bilingual data outside the dictionaries.
- **Tests**: fixed sleeps (`waitForTimeout`) remain in e2e specs, mostly waits for something not to happen or for the fake microphone; some `.catch(() => {})` swallow errors in teardown and in waits whose failure the spec records as a finding; tests shrink to one fixture scene when `public/data` is missing; the fixture client's status codes differ from the worker's for a few errors (scene-locked, practice-closed, potions-full); the scene-page hint-bubble check is flaky under heavy machine load; the pre-commit practices part reports a crash as "found problems"; screenshot specs other than the karaoke one may capture in the same frame as a scroll (a black band).
- **Small fixes**: a `Panel` without a colour inside a coloured one takes the outer colour (`--c` is inherited), so it breaks the colour rule unless it names `paper`; exports nothing uses (`useWidth`, `useMounted` in `home/hooks.ts`, `scenesOfLine` in `worker/content.ts`, `LEVEL_COUNT`, `requirePuzzleType`, `hasExactTimes`, `sceneWindow`, `pendingEvents`).
- **Not built yet**: other kinds of rewards than one chest per quest, and achievements for several full streaks in a row ([intent.md](intent.md), "Open questions").

## Suggested, not built

Normalising the loudness of a karaoke take before upload (it plays at its recorded level, which may be quiet over the song); aligning the account-name filter with the karaoke word list (the name filter lacks some words the karaoke refuses); a "play without my voice" switch on a song that has a recording; saying "kept on another device" when keeping fails with `no-take`.
