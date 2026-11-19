# Producing the app's own French content

How the app's own French gets written or revised: French titles, difficulty, the funny questions and answers, line alternates, and the units of all of these. Read before writing or revising any of them. The writing is a content step, done by an LLM or a person: what each job is given, the exact formats, the rules of good output and what the checker enforces are in [content-steps.md](content-steps.md) (the owner's writers were LLM subagents whose prompt files are not included).

## The rules in short

- **Faithful to the show.** No softening, skipping or replacing of the show's content on a writer's idea of what suits children; questions of appropriateness belong to whoever runs the project ([intent.md](intent.md), "Principles"). Every brief carries the rule.
- **A question is re-exposure, not a test**: about what is said or meant in the scene, answerable from its lines, in simple French; the wrong answers are clearly wrong and funny, and the jokes vary.
- **Every piece of French is tappable**, so every question, answer and alternate is split into units with their English, covering every word exactly.
- **Literal English and French names**, as for the scene lines.
- **Difficulty** (1 to 5) is how hard the scene's French is to follow by ear. A value in the questions file overrides the export's estimate; song scenes are capped at 2 by the export ([app-export.md](app-export.md)).
- **Alternates**: exactly two per line, keeping the line's shape and rhythm, funny, plainly different from the line and from each other.

## Files

| File | Written by | What |
|---|---|---|
| `app/data/questions/<episode>.json` | job 1 | per scene: `title_fr`, `difficulty`, 1–2 questions with 3–4 answers, `doubt` |
| `app/data/questions/<episode>.units.json` | job 2 | sentence → units, for every question and answer |
| `app/data/alternates/<episode>.json`, `<episode>.part<n>.json` | job 3 | line id → two alternates with their units; the export merges all files of an episode, and a line in two files is an error |

This repository holds one example, [app/data/questions/s01e01.json](../app/data/questions/s01e01.json) with its units file: two scenes' worth of the owner's season-1 content. The rest of the questions and all the alternates are not included; write your own for your episodes. A scene without questions still exports (no `question` puzzle, its English title as `titleFr`), and a line without alternates is not offered in `say-choice`, which needs two.

## Procedure

1. **Sheets** (from the repository root):
   - titles, difficulty, questions: `.venv/bin/frenchirix question-sheet <episode>` → `work/questions/<episode>.sheet.md`;
   - question and answer units, after job 1: `.venv/bin/frenchirix question-sentences <episode>` → `work/questions/<episode>.sentences.md`;
   - alternates: `.venv/bin/frenchirix alternates-sheet [--scenes all|release] [--per-sheet 10]` writes a sheet for every run of scenes that still have lines without alternates, in episode and timeline order, and merges into `work/alternates/sheets.json` which lines each sheet assigns. Sheets are numbered after the highest existing `app/data/alternates/<episode>.part<n>.json`, so new part files never collide with old ones. A line shared by two scenes is assigned to one sheet only and marked SKIP elsewhere; lines that already have alternates are marked SKIP.
2. **Pilot.** One writer on one sheet, told the job, the sheet path and the output path. Sample a few scenes of its output and tighten the brief before fanning out.
3. **Fan out**: one writer per remaining sheet, in parallel if they are LLMs. Each writes only its own output files.
4. **Check** every file (the writers run these too):
   `.venv/bin/python scripts/check_questions.py app/data/questions/<episode>.json`,
   `… --units app/data/questions/<episode>.units.json`,
   `… --alternates <n>` (or a single alternates file).
5. **Voice clips** for new or edited sentences: `scripts/tts_questions.py` ([app-tts.md](app-tts.md)); it makes only the missing clips.
6. **Export**: `.venv/bin/frenchirix export-app`, so the bundle picks up the text, the units and the clips; then `npm run check` in `app/`.

To revise a few items, give one writer the existing file, the scenes or lines to change and why, and run steps 4 to 6.
