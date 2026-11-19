# Content steps: what goes in, what must come out

The pipeline steps that need judgement about the show's language, and that code cannot do: choosing scenes, annotation, the notes pass, review fixes, and the app's own French (titles, difficulty, questions, line alternates). For each: what the step is given, the exact file it must write, the rules of good output, and the check the file must pass. Read before doing one of these steps, or before briefing an LLM or a person to do it. Where each step sits in the order of work: [runbook.md](runbook.md); how its file is loaded: [pipeline.md](pipeline.md) and [app-content.md](app-content.md).

The project's owner ran these steps with LLM subagents (Claude models) whose prompt files are not part of this release. Supply your own: any capable LLM, or a person, can do them from this file. A brief for one step needs this file's section for it, the per-show context file ([show-context.md](show-context.md) is this show's), the input file and the output path.

## Contents

- **Rules for every content step**.
- **Selecting scenes**: `work/<ep>/sheet.txt` → `selections/<ep>.json`.
- **Annotating**: `work/<ep>/annotate-NN.txt` → `annotations/<ep>/NN.jsonl` (final French, literal English, units, notes).
- **The notes pass**: more notes in existing annotation files.
- **Translation corrections**: `corrections/<ep>.json`.
- **Fixing review marks**: a review mark → the files above.
- **Titles, difficulty and questions**: → `app/data/questions/<ep>.json`.
- **Units of questions and answers**: → `app/data/questions/<ep>.units.json`.
- **Line alternates**: → `app/data/alternates/<ep>.part<n>.json`.

## Rules for every content step

- **Faithful to the content.** Write what is said, translate it as it is, explain what is there, in the show's own tone. Never soften, skip or replace a word, a joke, a reference or a scene because of a writer's idea of what suits children: the show is already rated for children, and any question of appropriateness belongs to the person who runs the project ([intent.md](intent.md), "Principles"). A writer who thinks something needs that judgement writes it faithfully and flags it in the report. Put this rule in every brief.
- **Read the show's context file first** (characters, the French-to-English name table, running jokes, how characters speak). It is what tells a writer that a line is a joke.
- **French names everywhere**, also in English text: the show's English subtitles rename characters; ours keep the French names (the name table of the context file).
- **Return line numbers, not text code can derive.** Code fills in times and subtitle text.
- **Write only the output file** of the step. Run no command that writes `assets/db.sqlite`; loading the files is a separate step, run once every file of an episode is done.
- **Run the step's check** and fix everything it reports before handing the file in.
- **Report doubts**: every reading, fact or judgement the writer could not settle, one line each, with the line number. They are the first things to check by ear.
- **Get facts right** (who speaks, what a word means, what is on screen): a wrong fact taught to a kid is worse than none. Not knowing what a line means is a reason to look at the scene's frames and subtitle cues, never a reason to skip it.

## Selecting scenes

**Input**: the episode id, `work/<ep>/sheet.txt` (written by `frenchirix sheet <ep>`), and how many scenes to choose (about 40 per 25-minute episode in season 1). The cue sheet has one row per French subtitle line:

```
0041 05:12 (Name) Texte français | English translation
0042 05:15 Suite de la phrase | ^
     [rires]
--- 12 s ---
```

- The number is the line number; the time is `mm:ss` in the episode. `(Name)` is the speaker, only where the hearing-impaired subtitles give one; `♪ ` before the text marks a sung line.
- `^` in the English column: the line shares its translation with the line above. Such lines form a translation group, which a scene must not split.
- ` / ` inside a text separates two lyric lines; a second speaker's part starts with `- `.
- Indented rows in square brackets are sound descriptions from the hearing-impaired track; they have no line number. `--- 12 s ---` is a pause with no dialogue.

**Output**: `selections/<ep>.json`:

```json
{
  "episode": "s01e04",
  "selector": "your-model:select-v1",
  "scenes": [
    {"first": 41, "last": 44, "title": "Short English title", "kind": "dialogue",
     "tags": ["joke", "wordplay"], "score": 4,
     "why": "One sentence: what makes it funny or useful, explaining any pun or idiom."}
  ]
}
```

- `episode` must be the episode imported. `selector` is a free label of who chose (stored as `scenes.selected_by`).
- `first`, `last`: line numbers, inclusive, lines that exist, `first` ≤ `last`. Order the scenes by `first`.
- `title`: non-empty, in English, at most 6 words (more is a warning).
- `kind`: `dialogue` (two or more speakers), `monologue` (one) or `song`.
- `tags`: a list of strings (may be left out). The ones used: `joke`, `wordplay`, `idiom`, `slang`, `insult`, `emotion`, `plot`, `running-gag`, `reference`, `song`.
- `score`: an integer 1 to 5 for how good a scene it is; 5 is a scene a kid should meet first. Use the whole range (left to itself, a model uses mostly 3 to 5).
- `why`: one sentence in English; when the humour rests on a pun, a name or a reference, say what it is.
- `select-import` rejects the whole file on any error above. It warns, and goes ahead, on: a range that splits a translation group (it is widened to the group), more than 12 lines or 40 s, a title over 6 words, a range given twice (the first is kept). What it keeps on re-import: [pipeline.md](pipeline.md), "Loading a selection".

**What a good scene is** ([intent.md](intent.md), "Content: scenes, texts and media"):

- One to a few lines; a single line is enough when it is a full, interesting sentence. Season 1 accepted up to about a dozen.
- Enough interesting French: real sentences, not just names, exclamations or counting.
- Preferably funny; otherwise interesting, expressive or emotional.
- Self-contained: one subject, one beat or one joke, understandable without the episode. Include the set-up a punchline needs and stop once the joke has landed.
- Scenes may overlap: an exchange with two jokes makes two scenes.
- Songs with funny or plot-related lyrics are prime material: split them into a verse or couplet per scene and cover the whole song.
- Spread the scenes over the whole episode. Prefer wordplay, idioms, colloquial speech and running gags, what a learner does not find in a textbook. A line with an empty English column is worth it only if the scene is.

**Check**: the file parses as JSON; then `frenchirix select-import <ep>` validates it and prints every error at once.

## Annotating

**Input**: one sheet `work/<ep>/annotate-NN.txt` (written by `frenchirix annotate-sheet <ep>`, about twelve scenes each; scenes sharing a line are on the same sheet). Output: `annotations/<ep>/NN.jsonl`, same `NN`.

```
### s01e04-0041-0044 | dialogue | Short title
heard: everything recognition heard in the scene's window
0041 (Name) ♪ FR  French subtitle text
     EN  The show's English subtitle
     ASR what recognition heard during this line
0042 (annotated above) FR  …
```

- `heard:` is the speech recogniser's output for the whole scene window, a little before and after included. `ASR` is what it heard inside the line's subtitle time; subtitle times are approximate, so a word may appear under the neighbouring line.
- `EN` is `^` when the line shares the translation of the line above, empty when there is none. ` / ` inside a text is a line break.
- A line marked `(annotated above)` belongs to an earlier scene of the sheet: it is not annotated again.

**Output**: one JSON object per line of the file. For each dialogue line, in sheet order, a line object; after the last line of each scene, that scene's scene object (one for every scene of the sheet, with an empty list when there is nothing to explain). An invented example:

```json
{"line": 41, "fr": "Dis donc, ton menhir est vachement lourd !", "en": "Say, your menhir is really heavy!", "units": [{"t": "Dis donc", "k": "expression", "en": "say"}, {"t": "ton menhir", "k": "word", "en": "your menhir"}, {"t": "est vachement lourd", "k": "expression", "en": "is really heavy", "note": "Familiar: \"vachement\" means \"very\"."}]}
{"scene": "s01e04-0041-0044", "notes": [{"kind": "reference", "line": 41, "phrase": "ton menhir", "text": "A menhir is a tall standing stone that people put up thousands of years ago."}]}
```

- Line object: `line` (the line number), `fr`, `en`, `units` (non-empty), each unit `t` (copied from `fr`), `k` (`word` or `expression`), `en` (non-empty) and an optional `note` (a string). A line break inside a text is `\n`. A line may appear only once in the episode's files.
- The units, read in order, contain every word of `fr` exactly once, as `split_words` in `frenchirix/text.py` splits words (punctuation between units may be left out). A unit never crosses a line break.
- Scene object: `scene` (the id from the sheet's `###` header) and `notes`, each note `kind` (`reference` or `wordplay`), `text` (non-empty), and `line` with `phrase` together, or neither for a note about the whole scene. `line` is in the scene; `phrase` is found as a run of words in that line's `fr`, ignoring case, accents and punctuation. A scene object may be given only once.
- What the import does with the file (what it keeps, its warnings): [pipeline.md](pipeline.md), "Annotation import".

**`fr`: what is actually said.** The French subtitle is simplified; recognition is literal but mangles names and confuses words that sound alike. Reconcile them:

- Take the wording from recognition: fillers ("euh", "ben"), repetitions, the "ne" of a negation, the full phrasing of a shortened sentence, the order things were said in. Write reductions ("t'as", "y a") only where recognition shows them.
- Take from the subtitle: the spelling of names and invented words, the choice between homophones, the punctuation style. Where recognition is implausible (names, puns, accents, shouting, singing over music), keep the subtitle.
- Never write a word neither source supports. Between two readings, keep the subtitle's and report the doubt.
- Each spoken word goes in one line only; words heard between two lines go where they fit; words outside the scene's first and last line only when they complete its first or last sentence.
- Keep the shape of the subtitle line: two speakers as `- part` lines separated by `\n`; sung lines keep their lyric line breaks.

**`en`: a literal translation.** Close to the French sentence where English allows it, still readable. French names. Wordplay translated as the French has it, not as the show's English subtitle replaced it; that subtitle helps with meaning and is not the answer.

**`units`: the breakdown.**

- A `word` unit is one word worth learning by itself: long, not a pronoun, article, preposition, conjunction or auxiliary, and not one of the most common words. It may carry the small words that lean on it (its article or possessive, an elided pronoun, a "de"). Proper names are `word` units.
- Everything else is in `expression` units, usually 2 to 5 words that belong together (a verb with its subject pronoun and auxiliaries, a noun with its article and adjective, a prepositional phrase). An idiom stays whole even when longer.
- A short common word never stands alone, except when it is all there is (a lone interjection or one-word turn: an `expression`).
- `en` is a literal gloss of the piece as used here. `note` only when the gloss is not enough (what an idiom means, a familiar register, how a pun works), in one short sentence.

**Notes: what a ten-year-old needs explained.**

- `reference`: something outside the dialogue the kid needs: a thing or word from the story's world or time they may not know in any language (for this show: toga, legion, menhir, druid), a real person or event, a famous phrase, a film or song, something about French life.
- `wordplay`: the joke is in the words: a pun, a name that sounds like a phrase, a double meaning, a bent idiom, a made-up word. Spell out both sides, with the French quoted and translated.
- Simple English for a ten-year-old: short sentences, everyday words, nothing assumed. Say what the thing is, then why it matters or is funny here. One to three sentences.
- Things that come back across the show get the same wording everywhere, and a note in every scene that names them, once per scene, at the first place the scene names them (kids meet scenes in any order). Keep the agreed wordings in one file the writers share, and start each such note with the agreed text, adding at most one sentence for this scene.
- `phrase` is the shortest phrase that names the thing, copied from that line's `fr`; no two notes of a scene on the same phrase. A unit's `note` stays one short line; the scene note carries the detail.
- A rude, dark or cruel joke gets its note like any other, in plain words. A scene with nothing to explain gets an empty list.

**Check**: `.venv/bin/python scripts/check_annotation.py annotations/<ep>/NN.jsonl` (the file alone: JSON, the fields, units tiling `fr`, units across line breaks, note phrases in their line, a file that does not end with a scene object). Then, when every sheet of the episode is done, `frenchirix annotate-import <ep>` checks the rest against the episode. `annotated_by` is not in the files: pass `--by <label>` to `annotate-import` (the default label is the owner's, `sonnet:annotate-v1`).

## The notes pass

An optional second pass over annotated files that adds the notes a ten-year-old is still missing, mostly things from history, myth and old-time life. Season 1 needed it; for a new episode it is worth it only when a sample of the annotation shows gaps.

- **Input and output**: the annotation files of one episode, edited in place; only the scene objects' `notes` change. Never a line's `fr`, `en`, units, or the order of records; a wrong one is reported, not fixed. Edit with a short script that loads each record and writes it back with `json.dumps(obj, ensure_ascii=False)`, so the formatting stays identical, and keep a copy of each file first.
- **What to add**: for every word or thing a scene's lines name that a ten-year-old who never opened a history book may not know in any language, a `reference` note. Not for words any ten-year-old knows, not for a French word that is merely hard (that is the unit's English), not for what the scene itself explains. The test: would the English translation alone leave the kid asking "what is that?". Sparingly, a fact of the story's world the scene cannot be understood without, on the word nearest to it.
- Keep existing notes; improve one only when it is wrong or above a ten-year-old's head. Name puns get a note only where the scene introduces the character or plays on the name.
- When a note depends on who speaks, check the speaker labels of the hearing-impaired cues (`cues` with track `fr_sdh`, read-only); when unsure, name no one. Check each sentence against the scene's time in the story (a flashback).
- **Check**: `scripts/check_annotation.py` on every changed file, and a diff that shows only `notes` changed. Then `annotate-import <ep>` and "After any data change" ([runbook.md](runbook.md)).

## Translation corrections

A wrong or missing subtitle English, which is only the fallback of the literal English and what the sheets show, is fixed in `corrections/<ep>.json`; the format and rules are in [pipeline.md](pipeline.md), "Translation corrections". The `first`..`last` of an entry is the exact range of the translation group (the `review context` of a mark prints it). Then `frenchirix import <ep>`.

## Fixing review marks

The person reviewing marks lines, or one unit, in the review UI with a category and a comment ([review-ui.md](review-ui.md)). The comment is the instruction: do what it asks; where it leaves details open, follow the annotation rules above. Fix what the mark is about and what the fix entails (new French needs new units, a matching `en` and note phrases that still occur in it), nothing else. An unclear comment, or one that contradicts the scene, leaves the mark open with the reason.

- **Input**: `.venv/bin/frenchirix review context <id>`: the mark and comment, the scene's lines (subtitle French and English, what recognition heard, final French and literal English, speaker, times), the marked line's units, the scene's notes, the files the fix goes through (with the exact line of the annotation file), and the questions and alternates built on the line.
- **Where each category goes**: `translation`: the line's `en` and its units' glosses in `annotations/<ep>/NN.jsonl` (`corrections/<ep>.json` only when the comment is about the subtitle itself). `french`: the line's `fr`, then its units and `en`; the line loses its word timings. `units`: the line's `units`. `notes`: the scene object, or a unit's `note`. `timing`: not a text fix; re-aligning is a GPU step ([runbook.md](runbook.md), "Repairing a scene"). `other`: read the comment.
- **Steps**, per episode: edit; `check_annotation.py` on each edited file; `annotate-import <ep>` (or `import <ep>` after a corrections edit), and fix any new warning on a touched line; revise the questions, answers and alternates the fix makes wrong (the sections below) and run `check_questions.py`; `frenchirix check` (a line whose French changed reports `words.untimed` until `align` runs); `export-app`, then `npm run check:practices` in `app/`; `frenchirix review resolve <id> --status done --resolution "…"` saying what changed in which file, or `--status dismissed` with the reason.
- **Report**: per mark what was done; the lines that need `align`; every revised French sentence (it needs a new voice clip, [app-tts.md](app-tts.md)). Marks of one episode are fixed one fixer at a time: the import, `check` and `export-app` must not run over each other.

## Titles, difficulty and questions

**Input**: `work/questions/<ep>.sheet.md` (`frenchirix question-sheet <ep>`): per scene its id, English title, kind, `why`, its lines as `line id | speaker | French | literal English`, and its notes. **Output**: `app/data/questions/<ep>.json`. The example in this repository is [app/data/questions/s01e01.json](../app/data/questions/s01e01.json) (two scenes):

```json
{"episode": "s01e04", "scenes": {
  "s01e04-0016-0017": {"title_fr": "…", "difficulty": 3, "doubt": null, "questions": [
    {"line": "s01e04-0017", "fr": "… ?", "en": "…", "answers": [
      {"fr": "…", "en": "…", "correct": true},
      {"fr": "…", "en": "…", "correct": false},
      {"fr": "…", "en": "…", "correct": false}]}]}}}
```

What `scripts/check_questions.py` enforces:

- The file is named `<episode>.json` and `episode` matches. Scene keys are scenes of the episode; the checker lists every scene of the episode that the file lacks. A scene object has only `title_fr`, `difficulty`, `questions`, `doubt`; a question only `line`, `fr`, `en`, `answers`; an answer only `fr`, `en`, `correct`.
- `title_fr`: 3 to 40 characters. `difficulty`: an integer 1 to 5. `doubt`: a string or `null`.
- 1 or 2 questions. `line` is a line id of this scene or `null` (the scene as a whole). `fr`: 3 to 14 words, ending in `?`. `en` non-empty.
- 3 or 4 answers, 1 to 10 words each, no two the same (ignoring case and punctuation), exactly one `correct: true`, each with a non-empty `en`.
- A sentence must not contain a line break or a double space (the sentence sheet refuses it).

The rules of good output:

- **`title_fr`**: short and catchy, a title a kid would recognise the scene by; not a translation of the English title unless that works.
- **`difficulty`**: how hard the scene's French is to follow by ear for a ten-year-old immersion pupil. 1: a few short common words, slow and clear; 2: short everyday sentences; 3: normal dialogue with a few uncommon words or one idiom; 4: fast, long or dense (several idioms, wordplay, slang, sung lines running together); 5: hard even for an adult learner. Use the whole range; most scenes are 2 to 4. It overrides the export's estimate; song scenes are capped at 2 by the export.
- **A question is re-exposure, not a test**: about what is said or meant in this scene (what someone does, wants, means, or why), answerable from the scene's own lines; `line` is the line holding the answer. Not about who speaks unless the sheet or the line says it, not about what only the picture shows, not trivia from outside the scene. Two questions only when the scene has two distinct things worth asking.
- Simple French: present or passé composé, words a ten-year-old immersion pupil knows plus the scene's own words. Reusing the scene's words in the question and the right answer is good: that is the re-exposure.
- The right answer is plainly right to anyone who understood the line; it rephrases or reuses the line without copying a long line whole.
- The wrong answers are the fun part: clearly and certainly wrong, never close in meaning to the right one, silly and vivid. Vary the jokes across an episode (a joke source used everywhere gets old). A wrong answer that sounds like the right one is excellent: it makes the kid listen. Answers of similar length and shape, so the right one does not stand out (the puzzle shuffles them).
- For a pun, asking which word the joke plays on, with sound-alike wrong answers, beats asking a literal fact.
- `en`: a plain literal English version of each question and answer; for an idiom the literal words and the sense, "new heads (new faces)".
- `doubt`: set when unsure a question is fair or an answer certainly right.

A scene without an entry still exports, with no question and its English title ([app-architecture.md](app-architecture.md), "Content bundle").

## Units of questions and answers

**Input**: `work/questions/<ep>.sentences.md` (`frenchirix question-sentences <ep>`, after the questions file): every distinct French sentence of the episode's questions and answers, `French | English`. **Output**: `app/data/questions/<ep>.units.json`, an object from each sentence, copied exactly, to its units in order, each `[French piece, English of that piece]` (example: [app/data/questions/s01e01.units.json](../app/data/questions/s01e01.units.json)):

```json
{"Que reproche-t-on aux Gaulois ?": [["Que reproche-t-on", "what do they blame"], ["aux Gaulois", "on the Gauls"]]}
```

What the checker (`--units`) enforces: an entry for every sentence of the questions file and no other; 1 to 5 pieces, each 1 to 4 words (a hyphenated or elided form is one word) with non-empty English; the pieces found in the sentence in order, covering every word, with nothing but punctuation and spaces between them; no piece starting or ending with punctuation or a space. A sentence with no entry, or whose pieces do not tile it, is exported as one whole-sentence unit.

Rules of good units, which also hold for alternates: a piece is a word or a short expression that means something together (article and noun, subject and verb, a fixed phrase); a long, rare or important word may stand alone; most sentences have two or three. The English is the meaning of that piece in this sentence, short, literal, lower case, no full stop; for an idiom the literal words and the sense. A proper name keeps its French form as its English. Check the French itself (agreement, accents, elision): kids learn spelling from it.

## Line alternates

An alternate is a funny altered version of a scene line that a kid may choose to say instead of the original in a speaking puzzle (`say-choice`; no choice is wrong).

**Input**: `work/alternates/sheet-<n>.md` (`frenchirix alternates-sheet`, which also records in `work/alternates/sheets.json` which lines each sheet assigns): scenes with id, title, kind, context and lines; a line marked SKIP already has alternates or belongs to another sheet. **Output**: one file per episode on the sheet, `app/data/alternates/<ep>.part<n>.json`, holding exactly the sheet's lines not marked SKIP, each with exactly two alternates (an invented example):

```json
{"s01e03-0024": [
  {"fr": "On mange bien, il pleut des crêpes", "en": "We eat well, it is raining crêpes",
   "units": [["On mange bien", "we eat well"], ["il pleut des crêpes", "it is raining crêpes"]]},
  {"fr": "On a sommeil, il neige des chaussettes", "en": "We are sleepy, it is snowing socks",
   "units": [["On a sommeil", "we are sleepy"], ["il neige des chaussettes", "it is snowing socks"]]}]}
```

What the checker (`--alternates <n>`, or a single file) enforces: keys are line ids of the episode that belong to a scene (and, for a sheet, exactly the lines it assigns); exactly two alternates, each only `fr`, `en`, `units`; `fr` 2 to 14 words and different from the line and from the other alternate (ignoring case and punctuation); `en` non-empty; units tile `fr` as for questions, with no limit on their number or length. The export merges every file of an episode, and a line in two files is an error.

Rules of good alternates: keep the shape and rhythm of the original; play on the scene's situation or gag (the sheet's context), or on the sound of the line's own words, mixing both across a sheet; funny, in the show's tone, faithful as above; plainly different (at least two content words or the meaning changed; one word is enough only for a line of four words or fewer); a line over 14 words is trimmed, keeping its opening words and rhythm; two speakers in one line become one line without the dashes; English literal with French names. Vary the joke sources across a sheet.

**Check** for both files: `.venv/bin/python scripts/check_questions.py app/data/questions/<ep>.json`, `… --units app/data/questions/<ep>.units.json`, `… --alternates <n>`. Then the voice clips ([app-tts.md](app-tts.md)) and `export-app` ([app-content.md](app-content.md), "Procedure").
