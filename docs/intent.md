# What the user wants

The design rationale of Frenchirix: the goals, rules and decisions of the project's owner (called "the user" throughout these docs, because the docs were written for the AI agents working with them) for the app and its content, as they stood when the project was published, with the owner's own words where they settle a question. It explains why the app is the way it is. Read before any product, game-design, UX or content decision. Where code or another doc disagrees with this file, this file wins and the other gets fixed; for your own copy, your decisions replace these where you differ, and where this file is silent, the decision is yours. Terms are those of the glossary in `AGENTS.md`. Superseded decisions are not kept here.

## Contents

- **Principles**: the rules that decide everything else.
- **Who it is for**: the kids, the show, the aim.
- **Practices and levels**: what a practice is, how long, leaving and continuing, spaced repetition.
- **Daily quests and streaks**: what Home asks a kid to do each day.
- **Choosing new scenes**: candidates, songs first, "Do more".
- **Puzzles**: what every puzzle must do, and the puzzle types the user asked for.
- **Speaking**: the microphone puzzles.
- **When something goes wrong**: errors, reports, logs, stuck puzzles.
- **Accounts**: no registration, names and PINs.
- **Rewards and social**: XP, chests, avatar, achievements, leagues.
- **Look and platform**: art direction, devices, language, install, `/dev`.
- **Content: scenes, texts and media**: what a scene is and what its texts and media must be.
- **The review UI**: the local tool for reviewing scenes.
- **Working method**: how the work is organised.
- **Open questions**.
- **Future work the user wants, not now**.

## Principles

- **Re-exposure, not tests.** The puzzles are an excuse to go over the dialogue again. The answers are always on the same page: wherever French is shown, each unit is its own coloured box; tapping it shows its English and loops its audio. Nothing is hard enough to get a kid stuck or frustrated.
- **Keeping the kid interested comes first.** "It's more important to retain the kid and keep them interested than to force them to do something that's educational."
- **Do not overengineer.** "We want to do the best practices of not overengineering things and do not overcomplicate things when the gained value from this isn't that big." Every design choice weighs the value against the work and the complexity; prefer the simple version.
- **Faithful to the content.** "Do NOT proactively self-censor the content based on your misguided understanding of concerns for kids' appropriateness … Your goal is to just faithfully rely on reflecting the content. … all the original assets and the story and everything are from a children's TV show that is already rated for kids' audience. More generally, any of these concerns require human and creator judgement." This applies to every scene, line, note, question and alternate, and to every brief for an agent that writes or selects content. Said again on 2026-11-15, when agents had left two jokes unexplained: "do not voluntarily go into the nanny mode and start proactively censoring content because you find it offensive somehow. It's up to humans, and the original content is from a mainstream children's show."
- **Audio is incentivised heavily.** Lines from the scenes being learned should get stuck as earworms: audio and the slideshow play in a loop and change with every selection. The looping matters.
- **Clear terms.** The user named vague terminology the most important problem to fix (2026-11-14): "vagueness and ambiguity has very high cost". One word per concept, used everywhere: code identifiers, file names, API paths, database names, interface text and docs were all renamed to the glossary in `AGENTS.md` ("take the plunge and rename everything for consistency"). When the user uses another word, tell them which term we use, so that they learn the same vocabulary.
- **Easy to catch when things go wrong.** The codebase should be resilient and maintainable, designed so that failures are detected rather than discovered by kids: there are many puzzle types, so the surface for things going wrong is large. Checks are programmatic where possible and run after every related change.
- **Common-sense edge cases degrade gracefully.** Logging in and out, the same account open in two browsers, finishing a practice in one browser while another is open, a kid away for many days: "we don't want to overengineer for things like this, but we want a more resilient design that in such edge cases handles things more gracefully."

## Who it is for

- **Canadian English-speaking kids learning French** (2026-11-15): notes and English texts may assume Canada. The French to teach is France's: "when in doubt, we would choose France French (or Paris French) over Quebec French because this is the learning target, but it's a soft recommendation, and we won't mention this anywhere in the app explicitly."
- Kids of about ten in French immersion.
- The content is a French children's cartoon series the kids know: *Astérix & Obélix : Le Combat des chefs* (Netflix, 2025, five episodes). Exposure to its unfiltered French is the point (comprehensible input). Background: [show-context.md](show-context.md).
- In functionality it should resemble "Duolingo at its best": streaks, daily quests, loot, avatars, leagues. It replaced an earlier, simpler version of the app built on word cards.

## Practices and levels

- **A practice covers the whole scene.** "The goal of the design of the number and structure of puzzles in the practice is to fully and comprehensively with some repetition and overlap … cover and practice all the dialogue (every dialogue line, and the inter-line dialogue) inside the scene." Puzzle types may repeat on different lines, mixed so the same type does not come over and over. Some puzzles work across 3–4 lines (comprehension, ordering).
- **Length.** The current lengths are right: up to 50 puzzles, depending on the length and complexity of the scene, about 28 for a typical scene (the user called "28–50 puzzles" right, describing these practices; small scenes may be shorter): "it actually won't take that long to complete a practice to a kid with some experience since the puzzles are pretty repetitive (which is part of the point), 15–20 minutes for the 3 practices is absolutely workable." Higher levels are as long as bronze.
- **Leaving and continuing.** A kid can leave a practice at any point, even leave it open in the browser, and continue later at the next unfinished puzzle, without redoing the practice. Only the number of finished puzzles is saved, never the state inside a puzzle. The interface shows how far a started practice is (a progress bar or a percentage) on the quest, on the scene and on the episode timeline. "Let's say a kid then needs to go somewhere, then they can just leave it where they were and then come back without losing their progress anytime they want."
- **Levels are the spaced repetition.** Passing a scene's practice for the first time passes it at bronze. The next day the practice at silver becomes due; then gold, titanium, diamond and plutonium, each after a wait that grows (1, 2, 4, 8, 16 days). "You won't be able to get all the levels on the same day. You have to wait. Of course, you are welcome to go back to that content before the day expires." Each level's practice has some randomness and different puzzles; "the practice is about the specific scene and its mastery of it by the kid." A level cannot be passed before it is due; before then the scene can be replayed for XP only.
- **The opening.** A practice opens with the whole scene, but not passively: the kid places up to five pieces into the right lines (`place-words`). Each line's panel carries its line's colour (the colour of its segment in the playback bar); tapping a line's panel selects it with an animation and loops its audio; a piece can be placed piece first or blank first (2026-11-14: "you should be able to do both").
- **Variety** (2026-11-14): "no duplicates, or similar puzzles (in both type of the puzzle and what part of content they cover) that feel identical come near each other in a practice"; the order varies "so that the types of puzzles and which part of the content (e.g. which dialogue lines or which expressions in the dialogue lines) would vary and don't over focus on monotonous coverage", while the practice still covers every line. A puzzle with mistakes does not come back later (there is no such mechanism); repetition comes from the coverage itself.
- **Where am I.** The practice screen always shows which level the practice is for (or that it is a replay), how far the kid is and how much is left: "we want for the kid to be able to see where they are and what part of the practice they are in, and how much is left" (2026-11-14).

## Daily quests and streaks

- **Purpose.** "Generate 3–5 specific things that the kid needs to do each specific day … the point is that the kid gets a right sized chunk of specific things to do every day": not too large or complicated, not too small. They are generated adaptively each day.
- **What a quest is.** "Each quest is either select 3 new scenes, or do a full practice at some level. For now, we keep things simple, and don't mess around with other types of quests."
- **Order.** Practices whose next level is due come first: "it's better to encourage kid to repeat and practice already learned material than to make the kid forget it and skip to the new one."
- **Never more than five.** A kid who lapsed must not come back to an endless, discouraging list.
- **New scenes every day.** Even with due practices waiting, every day lets the kid choose new scenes and pass at least one at bronze, "for the sense of exploration"; some kids find new scenes more exciting than repetition.
- **Due practices first** (2026-11-14): "when there are scenes in the Daily Quest progression to practice at the higher level, we would want the new scene selection locked, and the corresponding section would ask to finish first the preceding higher-level repetition and practices." The choose quest is locked until the day's due quests (at most 3) are passed.
- **"Do more".** When the kid has passed the bronze practices of the day's new scenes, a "Do more" button lets them choose 3 more out of 10 new candidates, the same day, as often as they like.
- **The rule** (proposed during development, confirmed by the user on 2026-11-14: "yes, let's do your proposal"): the day's quests are built once, at the day's first visit, never more than 5. First up to 3 due practices, most overdue first (so there is always room for something new); then always one "choose new scenes" quest (choose 3 of the candidates, 5 then, 10 since 2026-11-17); then the bronze practices of the scenes just chosen fill the remaining places. When all of the day's quests are done, "Do more" offers fresh candidates, and the bronze practices of those chosen become extra quests; they do not count toward tomorrow. Examples: nothing due → choose + 3 bronze practices = 4 quests; one due → 5; after a long absence → 3 due + choose + 1 bronze = 5.
- **Streaks.** Passing at least one practice in a day gives a **light streak**; doing all of the day's quests gives a **full streak**. The streak counter counts consecutive days with at least a light streak; each day shows as light or full; a potion (streak freeze) saves a missed day as a light day. Later: "we will introduce extra achievements for doing full streaks for several days in a row and extend the gamification to encourage full streaks."
- **Chests.** Each quest gives a chest; other kinds of rewards may be explored later.

## Choosing new scenes

- **Ten to choose from** (2026-11-17): "Let's change the number of new scenes to choose from from 5 to 10." Only the number offered changed; the kid still unlocks up to 3.
- Each time, 10 candidates are offered and the kid unlocks up to 3. The kid can come back from Home to choose more until 3 are chosen that day; a chosen candidate leaves the selection; when the third is chosen the others go back to the cauldron by themselves, with no separate action; candidates not chosen by the end of the day go back to the pool (2026-11-14). Candidates mix how funny or interesting a scene is (its score), randomness, and the kid's skill against the scene's difficulty. A candidate not chosen goes back to the pool. The kid can enter and watch each candidate before choosing.
- **Songs first.** "The scenes from songs are easier and more fun"; at the start, both songs (the start of episode 3, Panoramix's dreams, and the start of episode 4, the Romans' world) must be among the candidates, and song scenes count as top-quality (score 5).
- **The episode timelines** are the big progress tracker: each of the 5 episodes is a timeline of its scenes, locked at first. The Episodes tab lets the kid browse the scenes they unlocked, by default in the order they unlocked them, or in episode order; runs of locked scenes collapse to a count. A kid can enter an unlocked scene and just watch it: the slideshow with the lines and their tappable units.
- A karaoke screen plays the songs with their words to sing along; it starts playing when opened and can be stopped.
- **Recording yourself on a song** (2026-11-15): "You can now microphone record your singing along to the karaoke! After you recorded yourself, if there is voice, we send to whisper and just verify for profanities (singing something different is fine); if all is good, you get to hear the playback of you singing along with the song audiotrack; your singing can be saved or removed etc. If there is a recording of a song on this account, every time the karaoke is played to you, it's played with your recorded singing now!" How it is built, confirmed by the user on 2026-11-15: one recording per kid and song, kept on the server so it follows the account to any device; the profanity check is a word list over what Whisper heard, with the show's own words never counted; a take that fails the check is not kept. What Whisper heard of each checked take stays in the activity log like the rest (180 days), and an unsaved take waits for the daily purge: "ok. we don't need to remove it with timeout I think". Any kid on a shared device can switch player and hear another's recording: "of course it's fine". 20 checked takes per kid per day: "it's ok as it is". Starting a take unmutes the app: "yes, it's fine".

## Puzzles

Every puzzle type:

- **Cannot be failed.** A wrong move shakes, plays a sound and lets the kid try again; after two wrong moves on the same item the answer is shown.
- **Is about the French audio and its meaning.** Each round makes the kid hear French from the scene and connect it to its meaning. Anything French that is tapped loops its audio and stops what looped before.
- **Keeps the answers on the page.** The lines a puzzle uses are reachable as tappable units (the help strip); opening it is never punished.
- **Is a real mini-game**, with rich animation and effects and a reward moment at the end. The user invited new puzzle types of our own invention: "the point is the exposure to audio and text of French and engaging with its meaning and making sure that the kid understands the translation".
- **Works by touch** on a phone and on an iPad, with no hover-only behaviour.

- **Wrong choices are clearly wrong.** A wrong choice is never close in meaning to the right one: the kid often hears only a short fragment out of context ("Un monde": "a world" against "In this world" was too close, 2026-11-14). Puzzle building enforces it.
- **Choose, then confirm** in the funny question: tapping an answer selects it and plays its voice; a separate "That's it!" button submits it (2026-11-14).
- **All five meanings on screen** in `listen-pick`: "Delete the carousel entirely for the puzzle type listen-pick, always show all the choices on screen at once (obvs scroll down is fine)" (2026-11-17). Long meanings on a phone make the puzzle scroll; no one-at-a-time view.
- **Find the pairs** (`memory`): French and English cards have clearly different backs, "so that the kid is not frustrated wasting their time trying the matches of the cards in the same language" (2026-11-14).

What the user asked for, among the puzzle types: say a line after hearing it; say a hidden expression (English and a slideshow frame shown, the French masked to first letters); match French units to English; listen to a line and pick its English among five; fill blanks with the key words; funny questions in French about a line, read aloud in a funny voice, with funny answers; ordering and comprehension across 3–4 lines; the opener above.

- **All French is tappable**, including our own questions, answers and alternates: "including our own questions and answers".
- **A joke must not get old.** A question repeats only after a long gap and a limited number of times.
- **The hint bubble** shows only the English (never the French), points at the tapped unit, closes when tapped and closes on any other interaction.
- **The playback bar.** Wherever a whole scene plays, a bar lets the kid seek to any line; tapping a line seeks there.
- **Mute.** A mute button is always reachable.
- **Loops must not sound harsh**: short loops are padded with fades. Decided by ear: "let's go with the variant D".
- **Question audio** is generated ahead of time on the local GPU with a local French speech model, not by Workers AI.

## Speaking

- **Speaking must never frustrate or block a kid.** "Making these microphone lessons gameable is not as bad as making them frustrating to the kids."
- **Always clear when the microphone listens** (2026-11-14): one consistent microphone control in every speaking puzzle; while listening, a live cue that the voice is being picked up and a countdown; each listening lasts at most 10 seconds ("it will be very expensive for the microphone to just listen all the time"); the kid can pause and resume, "and then you never get stuck in a state where it's broken and you cannot continue with the puzzle."
- **No pointless recognition requests**: a take in which the device heard no voice is not sent to speech recognition and does not spend a try (proposed during development, welcomed by the user on 2026-11-14: "if we could use that to reduce pointless whisper requests, great").
- **"Say the line" is the whole line**: "Say the line is to say the whole dialog line", never a word or expression of it (2026-11-14).
- Every speaking puzzle has an always-visible "Je ne peux pas parler" button; it replaces this and the following microphone puzzles of the practice with tapping equivalents.
- After each try, give partial credit for what was recognised.
- **Homophones:** "our check shouldn't be 'what did he say' but 'did he try to say that or not'."
- **Decided:** "speech recognition with the Whisper hinting of the intended text … and just check the output for similar sounds … to some appropriate small model inside Workers AI. Basically, we want this audio recognition to work just by checking whether the kid at least attempted to say something similar and speak French, and in that case we would accept it." The third try at the same thing is always accepted.
- The three speaking puzzle types the user designed: say a full line as the character, in context ("the kid feels like they are playing that character"); five or six units in a row, hands-free ("if it's wrong, we get to hear the word again, and then you could speak again without any extra tapping"); choose among three lines, the original and two funny alterations, by saying one ("there are no wrong choices").
- `/dev/speaking` lets the user test recognition with their own voice.
- **Speech limit** (2026-11-17): "Speech limit: lets just 2x the limit and hope its enough". `SPEECH_PER_DAY` went from 300 to 600 tries per kid a day; the karaoke's take limit did not change. Context: the user hit what looked like the limit on one account while testing on several devices; an investigation found no counting bug (the count is per kid, from the session cookie, one call per try) and noted that a timeout or a recognition failure shows the same listen-back round as the limit.

## When something goes wrong

- **Failed API calls.** "We would want to show it as such, have a non-tech error message facing user and the smaller copy-pastable tech error context that can be copied and shown to the website admin (me) if needed. Then the webapp goes back to the last previous working state, so that the kid can try again." No offline mode: "making the webapp workable offline will be a lot of work".
- **Media that load slowly** (decided 2026-11-17). On a slow or spotty connection media take long to load and the kid could not tell what was going on: a page opens, nothing plays, and the app looks broken. So a screen whose media have not loaded shows an explicit loading state with a progress bar (in the comic style, progress that is honest, no flash when the media are already there). It waits only for what its first moment needs: the scene's or song's audio and its first frames, not the rest of a practice's clips, and the song never waits for the kid's recording. After about 8 s a "slow connection" line; after about 25 s, or when a file fails (implemented as 25 s without a byte arriving, so a slow load that keeps coming is not cut; the user left this and the other details of the loading gate to the developers on 2026-11-17: "just please do some sensible design for that loading gate"), the usual error with « Réessayer » (the kid's tap; no silent background retries). A play button never shows "pause" while its sound is still loading, and a sound that fails to load says so; except a question's clip, which keeps its silent fallback to the line's audio. A practice fetches its own later clips ahead in the background; nothing for other scenes. No service worker. How: [app-games.md](app-games.md), "Loading media".
- **No runtime safety net** for a stuck puzzle (no automatic skip button). Instead, stuck states are caught during development. Some puzzle types (`say-chain` in particular) "easily get into a broken state where there is no way to continue like there is no button or action that works to proceed next". So a check exercises every puzzle type through realistic combinations of outcomes (speech recognition passing, failing, unavailable or slow; audio ending or not; the microphone refused) and flags the puzzle types that can end with no way forward. It runs after every related code change; each new finding is investigated "if such an investigation wasn't done before", and its verdict is recorded so the same finding is not investigated twice.
- **"Quelque chose ne va pas ?"** A button where a kid types what went wrong; the report is stored in the production database with the context of where it happened. It sits in the practice header, on every error panel and in the profile, and a tip shows the kid at some point what the button is for. Reports not yet handled are brought to the user's attention (in the owner's setup, at the start of every agent session on the repository).
- **Activity log.** User activity, including errors, is logged for statistics. What speech recognition heard (the transcript) is kept, because it is small and useful for tuning; rows are kept 180 days. The user has no fixed position on storing audio; nothing in the docs states a rule about it either way.

## Accounts

- The whole site is behind one shared password on a comic-style gate page with a cover illustration.
- **No registration.** Opening the app in a new browser creates an account with a random funny name. A kid can use one browser forever without logging in. The account has a three-digit PIN, shown in the profile; name plus PIN logs in from another browser.
- **No email.** "Adding this email handling won't add that much value, but would be a lot of work, so let's forget about emails for now. … if they have a technical problem with lost login or something, they would just come up to me and I will fix it in the db manually."
- The kid chooses a name when making the avatar: free typing, with a bad-word filter.
- Several kids may share a device (a school computer, a sibling's iPad); a kid must be able to leave an account and start as someone else. **Switching players** (2026-11-14): the profile's switch button opens the selection of the players who used this device, to switch with one tap or add a new player, "so multiple kids can use the same device in the same browser and easily switch back and forth."

## Rewards and social

- XP, sesterces (spent in the shop), potions (streak freezes, can be given), chests, items that dress the avatar (hats, clothes, sports gear, instruments in a cartoon faux-Roman / Gaul / barbarian theme, with jokes), achievements with named rewards ("a new dinosaur suit").
- The avatar is built from tabs of options over a live preview.
- Social, with no messages between users: follows, a feed of friends' milestones, cheers (fixed stickers), gifts of items and potions, friend streaks, weekly leagues.

## Look and platform

- **A 1950s comic book**: "50s comics assertive aesthetics", bright, different colours per section, comic typography. Panels and boxes never have the colour of the background under them. Details: [app-style.md](app-style.md).
- **Mascot**: a green druid, for the icon and logo.
- **Devices**: designed for iPad and phone, with a layout for each; layout testing covers iPad and phone first (2026-11-14). The gate page is in English too.
- **Language**: a new account starts with the interface in **English** (decided 2026-11-14, replacing the earlier French default: "otherwise it might be too intimidating"), with a switch to simple French in the profile. Do not follow the browser's language. The scenes and the app's own French content stay French, of course; only the interface text changes. The interface text, in both languages, uses the glossary's terms (the French words are listed in `AGENTS.md`).
- **Installable and self-updating**: installable on Android and iOS "with an icon and everything"; a stale copy in a browser or on a home screen must update itself after a release.
- A `/version` page lists the releases, newest first, with patch notes.
- **`/dev`**: an admin, testing and development portal to browse and review scenes, practices and puzzle types; open when run locally, behind an admin password in production ("there is no vulnerable information in there, this is a casual non-profit … education project without any secrets").
- Cloudflare Workers, D1 for user data, Workers AI for speech recognition.

## Content: scenes, texts and media

- **A good scene**: anything from one line to a few lines (the user said "3–5"; 94 of the 203 scenes chosen have 6 to 12 lines, and all are accepted); enough interesting French, not just exclamations; preferably funny, otherwise interesting or expressive; self-contained (one subject, one beat or one joke); scenes may overlap. Songs with funny, plot-related lyrics are great, split into pieces. Each scene has a score for how good it is; it must stay possible to go straight to the funniest scenes. All 203 scenes of season 1 count as accepted, and all 203 go into the app's next release (decided 2026-11-14; release 2.1 had 50).
- **French: what is actually said**, reconciled from the subtitles (right names and meaning, dropped words) and speech recognition (literal, but mangles names and homophones).
- **English: literal, with French names.** The show's English subtitles rename characters and replace wordplay; ours translates what the French says, keeping French names and the French wordplay.
- **Units** tile each line: a single word when it is long, not a pronoun and rare enough; otherwise an expression. Every word belongs to exactly one unit.
- **Notes**, in simple English for a ten-year-old: they explain "the cultural references or words that they don't know in any language so that they can better understand the meaning of the French language used to teach them" — things from history like toga, breeches, legion; more elaborate cultural references; French wordplay needed to understand the dialogue. A note can be attached to the phrase it is about. A word with a note carries an asterisk the kid can tap. Notes cover "things that kids might not understand because they lack enough understanding of history or myth, not just cultural references. Things like 'toga', 'breeches' etc, we want those to have asterisks and the kid can take a look" (2026-11-15). Kids meet scenes in any order, so every scene that names such a thing gets its note, once per scene, in one wording across the show, also for the everyday ones (Gauls, Romans, the village, magic potion, druid, menhir, Caesar): "keep" (2026-11-15). A note explains a rude, dark or cruel joke as plainly as any other. Nothing is left out for what it says: "DO NOT … DECIDE TO LEAVE ANYTHING OUT BECAUSE YOU THINK IT'S TOO DARK, TOO CRUEL OR WHATEVER … THIS IS FROM A PRIME TIME TV SHOW FOR KIDS, IT'S AS VANILLA AS IT COMES … it's not your decision" (2026-11-15). An agent that does not know what a line means looks at the scene until it does; it never skips the line.
- **Audio**: preserve the quality of the original French track (pronunciation details matter); a scene's audio may be padded about 2 s with a fade-in so loud music does not start abruptly; the dialogue itself plays at full volume. The English audio track is not used.
- **Video**: a small slideshow of frames every 2 seconds (plus the first and last), 400 px high, optimised for size.

## The review UI

The local tool (`frenchirix serve`) is "still used and important to maintain". Its purpose is not to accept or reject scenes: "the point of the web UI is to allow for human review of specific scenes, because some scenes have errors in translation or some missing annotations and so on." The user goes through scenes one by one and marks lines (or parts of them) that need fixing, with notes; "later on … an agent would look at this and have all the necessary context to fulfill the marked correction".

## Working method

- Priority: the web app first; the pipeline is kept working.
- The work was done with AI agents: one main session orchestrates; subagents on a strong model build; subagents on a cheaper model read and write show content (choosing scenes, annotation, questions, alternates, review fixes), for cost. One exception the user asked for (2026-11-15): the pass over all scenes that adds the notes on history and myth used the strong model. How: [orchestration.md](orchestration.md).
- Reuse what is already on the machine: model weights and packages are checked for before anything is downloaded.
- Sanity checks are programmatic where possible (hooks that check that practices are passable and that puzzles cannot get stuck). "The point of a failing test is exactly this: to bring this to our attention and to sanity check this aspect of the system after the changes"; after heavy changes, a subagent reviews the affected puzzle or screen as a kid would meet it.
- Commit at every finished phase of work.

## Open questions

- **Other kinds of rewards** than one chest per quest, and achievements for several full streaks in a row.

## Future work the user wants, not now

- Nothing at the moment.
