// `npm run check:practices`: proves that the practices composed from the real content bundle can be
// finished and have what a kid needs on the page. See docs/checks.md.
//
//   npx tsx tools/check-practices.ts [--data <dir>] [--media <dir>] [--no-media] [--seeds n] [--all-scenes]
//   npx tsx tools/check-practices.ts --practice <scene> --level n --seed s [--speak off]   (compose one again)
//
// For every release scene (app/data/release.json; every scene of the bundle without it or with
// --all-scenes), every level 1-6, speak on and off and several seeds: compose the practice, validate
// it, play it with the perfect and the clumsy bot, assert the practice policy (coverage, the variety
// rule in type and content, the microphone spacing rule) and that it composes the same twice. (A replay is the practice at the
// scene's level, so it is covered.) A practice composed with speaking on is also held to the variety rule as
// played when speaking is turned off at any puzzle (its microphone puzzles from there replaced by their
// tapping rounds). Independently of the puzzle types:
// media files exist, time windows lie inside the audio, units tile their line, questions and
// alternates are well formed, every puzzle type describes itself. Exit code 1 on any problem.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentIndex, GlossUnit, Scene } from '../shared/content';
import { playPractice, type BotHooks } from '../shared/practice/bot';
import {
  ANGLES,
  COMPOSER_VERSION,
  LEVEL_ANGLES,
  MIN_ANGLES_PER_LINE,
  LINE_GAP,
  MIC_PER_WINDOW,
  MIC_WINDOW,
  TYPE_GAP,
  UNIT_GAP,
  VARIETY_SLACK,
  checkPracticePolicy,
  speakingOffSteps,
  varietyBreaks,
  composePractice,
  type ComposedPractice,
} from '../shared/practice/practice';
import { allPuzzleTypes } from '../shared/practice/registry';
import { altCloseness } from '../shared/practice/replace';
import type { AnyPuzzleType } from '../shared/practice/types';
import { validatePractice } from '../shared/practice/validate';

// ---- Arguments ---------------------------------------------------------------------------------

const appDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const flag = (name: string) => argv.includes(name);

const dataDir = resolve(arg('--data') ?? join(appDir, 'public/data'));
const mediaRoot = resolve(arg('--media') ?? join(appDir, 'public')); // '/media/a/x.m4a' -> <root>/media/a/x.m4a
const checkMedia = !flag('--no-media');
const SEEDS = Number(arg('--seeds') ?? 2);
const LEVELS = [1, 2, 3, 4, 5, 6];
const MAX_LISTED = Number(arg('--limit') ?? 40);
const PANONO = 's01e03-0023-0026';

// ---- Load --------------------------------------------------------------------------------------

if (!existsSync(join(dataDir, 'index.json'))) {
  // A clone without content (no assets/db.sqlite, no export) has nothing to check: say so and pass.
  // A bundle named with --data must exist.
  const how = 'build it from the repository root with:  .venv/bin/frenchirix export-app --data-only';
  if (!arg('--data')) {
    console.log(`check:practices: skipped, no content bundle at ${dataDir} (${how})`);
    process.exit(0);
  }
  console.error(`check:practices: no content bundle at ${dataDir}`);
  console.error(how[0]!.toUpperCase() + how.slice(1));
  process.exit(1);
}
const t0 = performance.now();
const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8')) as ContentIndex;
const scenes: Scene[] = index.scenes.map(
  (s) => JSON.parse(readFileSync(join(dataDir, 'scenes', `${s.id}.json`), 'utf8')) as Scene,
);
const sceneMap = new Map(scenes.map((s) => [s.id, s]));
// The release: the scenes whose practices are checked (all of the bundle without a release list).
const releasePath = join(appDir, 'data/release.json');
const releaseIds: string[] | null =
  !flag('--all-scenes') && existsSync(releasePath)
    ? (JSON.parse(readFileSync(releasePath, 'utf8')) as { scenes: string[] }).scenes
    : null;
const releaseScenes = releaseIds ? releaseIds.map((id) => sceneMap.get(id)).filter((s): s is Scene => !!s) : scenes;

// ---- Problems ----------------------------------------------------------------------------------

interface Finding {
  where: string; // how to reproduce
  sceneId: string;
  puzzleId?: string;
  type?: string;
  message: string;
}
const findings: Finding[] = [];
/** Practices composed with speaking on, played with speaking off from the first puzzle (the most replaced). */
const varietyOff = { puzzles: 0, breaks: 0, practicesWith: 0, worst: 0 };
const warnings: string[] = [];
if (releaseIds && releaseScenes.length !== releaseIds.length)
  for (const id of releaseIds.filter((x) => !sceneMap.has(x)))
    findings.push({ where: 'release', sceneId: id, message: `release scene ${id} is not in the bundle` });

// ---- Puzzle types -------------------------------------------------------------------------------------

const everyPuzzleType = allPuzzleTypes();
const buildCalls = new Map<string, number>();
const buildNulls = new Map<string, number>();
// Wrapped to count builds and nulls; the same logic otherwise.
const counted: AnyPuzzleType[] = everyPuzzleType.map((g) => ({
  ...g,
  build(ctx) {
    buildCalls.set(g.type, (buildCalls.get(g.type) ?? 0) + 1);
    const t = g.build(ctx);
    if (!t) buildNulls.set(g.type, (buildNulls.get(g.type) ?? 0) + 1);
    return t;
  },
}));

function printPlan(p: ComposedPractice): void {
  const sc = sceneMap.get(p.entries[0]!.sceneId)!;
  const short = (id: string) => id.slice(id.lastIndexOf('-') + 1);
  console.log(
    `  practice ${sc.id} level ${p.level} seed ${p.seed}: ${p.puzzles.length} puzzles ` +
      `(planned ${p.plan.plannedLength}), ${p.plan.steps.filter((x) => x.needsMic).length} microphone, composer v${p.composerVersion}`,
  );
  console.log('    #  mic type          angle    target  lines        reason');
  for (const [i, st] of p.plan.steps.entries())
    console.log(
      `    ${String(st.index).padStart(2)} ${st.needsMic ? '  *' : '   '} ${st.type.padEnd(13)} ${st.angle.padEnd(8)} ${(st.targetLineId ? short(st.targetLineId) : '-').padEnd(7)} ${st.lineIds.map(short).join(',').padEnd(12)} ${st.reason}` +
        (p.puzzles[i]?.alt ? ` (speaking off: ${p.puzzles[i]!.alt!.type})` : ''),
    );
  console.log('    coverage per line (got/demand): ' + ANGLES.join(' '));
  for (const c of p.plan.coverage)
    console.log(
      `    ${c.lineId} ` + ANGLES.map((a) => `${c.got[a]}/${c.demand[a]}`).join('  ') + `  angles ${c.angles}${c.shortfall ? `  (${c.shortfall})` : ''}`,
    );
}

function problemsOf(p: ComposedPractice, speak: boolean, puzzleTypes: AnyPuzzleType[] = everyPuzzleType): Omit<Finding, 'where'>[] {
  const sceneId = p.entries[0]!.sceneId;
  return [
    ...p.problems.map((m) => ({ sceneId, message: `composer: ${m}` })),
    ...validatePractice(p, sceneMap, { speak, puzzleTypes }),
    ...playPractice(p, sceneMap, { mode: 'perfect', puzzleTypes }),
    ...playPractice(p, sceneMap, { mode: 'clumsy', puzzleTypes }),
    ...checkPracticePolicy(p, speak, puzzleTypes).map((m) => ({ sceneId, message: `policy: ${m}` })),
  ];
}

// ---- Replay one --------------------------------------------------------------------------------

const onePractice = arg('--practice');
if (onePractice) {
  const scene = sceneMap.get(onePractice);
  if (!scene) {
    console.error(`no scene ${onePractice}`);
    process.exit(1);
  }
  const level = Number(arg('--level') ?? 1);
  const seed = Number(arg('--seed') ?? 1);
  const speak = arg('--speak') !== 'off';
  const input = { id: 'one', seed, scene, level, speak, bank: index.bank, others: [] };
  const p = composePractice(input);
  printPlan(p);
  if (speak) speakingOff(p, 'one');
  const problems = [...problemsOf(p, speak), ...findings];
  for (const x of problems) console.log(`PROBLEM ${x.puzzleId ?? ''} [${x.type ?? ''}] ${x.message}`);
  console.log(problems.length ? `${problems.length} problems` : 'ok');
  process.exit(problems.length ? 1 : 0);
}

// ---- Content checks (independent of the puzzle types) --------------------------------------------------

const PUNCT_OR_SPACE = /^[\s\p{P}\p{S}]*$/u;
let mediaChecked = 0;

// Our own French (questions and answers): the units tile the sentence in order, with only spaces
// and punctuation between and around them, every letter and digit covered, and English on each.
// Same rule as `frenchirix export-app --verify` (tile_units in frenchirix/app_export.py).
const VOICES: readonly string[] = ['squeaky', 'deep', 'wobble', 'echo'];
function glossTiles(text: string, units: GlossUnit[] | undefined, what: string, bad: (m: string) => void) {
  if (!units || units.length === 0) {
    bad(`${what} has no units`);
    return;
  }
  let pos = 0;
  for (const u of units) {
    if (u.cs < pos || u.ce <= u.cs || u.ce > text.length) {
      bad(`${what}: unit "${u.fr}" span ${u.cs}-${u.ce} is out of order or outside the sentence`);
      return;
    }
    if (text.slice(u.cs, u.ce) !== u.fr) bad(`${what}: text at ${u.cs}-${u.ce} is "${text.slice(u.cs, u.ce)}", unit says "${u.fr}"`);
    if (!PUNCT_OR_SPACE.test(text.slice(pos, u.cs))) bad(`${what}: "${text.slice(pos, u.cs)}" before "${u.fr}" is in no unit`);
    if (!u.en.trim()) bad(`${what}: unit "${u.fr}" has no English`);
    pos = u.ce;
  }
  if (!PUNCT_OR_SPACE.test(text.slice(pos))) bad(`${what}: "${text.slice(pos)}" after the last unit is in no unit`);
}

function media(sceneId: string, src: string | undefined, what: string) {
  if (!src) return;
  if (!src.startsWith('/media/')) {
    findings.push({ where: `content ${sceneId}`, sceneId, message: `${what} path does not start with /media/: ${src}` });
    return;
  }
  if (!checkMedia) return;
  mediaChecked++;
  if (!existsSync(join(mediaRoot, src)))
    findings.push({ where: `content ${sceneId}`, sceneId, message: `${what} file is missing: ${src}` });
}

for (const scene of scenes) {
  const bad = (message: string) => findings.push({ where: `content ${scene.id}`, sceneId: scene.id, message });
  const dur = scene.audio?.durationMs ?? 0;
  if (!(dur > 0)) bad('the audio has no duration');
  media(scene.id, scene.audio?.src, 'audio');
  media(scene.id, scene.thumb, 'thumb');
  if (scene.frames.length === 0) bad('the scene has no frames');
  for (const f of scene.frames) {
    media(scene.id, f.src, 'frame');
    if (f.t < 0 || f.t > dur) bad(`frame at ${f.t} ms is outside the audio (0-${dur})`);
  }
  if (scene.lines.length === 0) bad('the scene has no lines');
  const inside = (what: string, a: number, b: number) => {
    if (!(a >= 0 && b <= dur && a < b)) bad(`${what} window ${a}-${b} ms is not inside the audio (0-${dur})`);
  };
  for (const line of scene.lines) {
    inside(`line ${line.id}`, line.startMs, line.endMs);
    let pos = 0;
    line.units.forEach((u, i) => {
      if (u.id !== `${line.id}:${i + 1}`) bad(`unit ${u.id} should be ${line.id}:${i + 1}`);
      if (u.cs < pos) bad(`unit ${u.id} overlaps or comes before the previous unit`);
      else if (!PUNCT_OR_SPACE.test(line.fr.slice(pos, u.cs)))
        bad(`line ${line.id}: text "${line.fr.slice(pos, u.cs)}" before unit ${u.id} is in no unit`);
      if (line.fr.slice(u.cs, u.ce) !== u.fr) bad(`unit ${u.id} text "${u.fr}" does not match its span in the line`);
      if (!u.en?.trim()) bad(`unit ${u.id} has no English`);
      inside(`unit ${u.id}`, u.startMs, u.endMs);
      for (const w of u.words) {
        if (w.cs < u.cs || w.ce > u.ce) bad(`a word of unit ${u.id} lies outside the unit`);
        if (w.startMs < 0 || w.endMs > dur) bad(`word "${w.fr}" of ${u.id} is outside the audio`);
      }
      media(scene.id, u.drill, `drill of ${u.id}`);
      pos = Math.max(pos, u.ce);
    });
    if (line.units.length === 0) bad(`line ${line.id} has no units`);
    else if (!PUNCT_OR_SPACE.test(line.fr.slice(pos)))
      bad(`line ${line.id}: text "${line.fr.slice(pos)}" after the last unit is in no unit`);
  }
  // Line alternates (say-choice): units tile them like a question's; a named clip must exist.
  for (const line of scene.lines) {
    for (const [k, alt] of (line.alternates ?? []).entries()) {
      if (alt.fr.trim() === line.fr.trim()) bad(`alternate ${k + 1} of ${line.id} is the line itself`);
      glossTiles(alt.fr, alt.units, `alternate ${k + 1} of ${line.id}`, bad);
      media(scene.id, alt.audio, `audio of alternate ${k + 1} of ${line.id}`);
    }
  }
  const lineIds = new Set(scene.lines.map((l) => l.id));
  for (const q of scene.questions) {
    const n = q.answers.length;
    const correct = q.answers.filter((a) => a.correct).length;
    if (n < 3 || n > 4) bad(`question ${q.id} has ${n} answers (3-4 wanted)`);
    if (correct !== 1) bad(`question ${q.id} has ${correct} correct answers (exactly 1 wanted)`);
    if (q.lineId && !lineIds.has(q.lineId)) bad(`question ${q.id} is about line ${q.lineId}, not in the scene`);
    if (!VOICES.includes(q.voice)) bad(`question ${q.id} has voice ${JSON.stringify(q.voice)}, not one of ${VOICES.join(', ')}`);
    glossTiles(q.fr, q.units, `question ${q.id}`, bad);
    q.answers.forEach((a, i) => glossTiles(a.fr, a.units, `answer ${i + 1} of ${q.id}`, bad));
    // Pre-generated clips (docs/app-tts.md): optional, but a named clip must exist.
    media(scene.id, q.audio, `audio of question ${q.id}`);
    q.answers.forEach((a, i) => media(scene.id, a.audio, `audio of answer ${i + 1} of ${q.id}`));
  }
}

// ---- Puzzle descriptions (meta.name, purpose, depth, scope) -----------------------------------------

{
  const names = new Map<string, string>();
  for (const g of everyPuzzleType) {
    const m = g.meta;
    const bad = (message: string) => findings.push({ where: `puzzle type ${g.type}`, sceneId: '', type: g.type, message });
    if (!m.name?.trim()) bad('meta.name is missing');
    if (!m.purpose?.trim()) bad('meta.purpose is missing');
    if (!m.depth || !['intro', 'core', 'advanced'].includes(m.depth)) bad(`meta.depth is ${String(m.depth)}`);
    if (!m.scope || !['unit', 'line', 'long-line', 'multi-line', 'scene'].includes(m.scope)) bad(`meta.scope is ${String(m.scope)}`);
    const key = (m.name ?? '').trim().toLowerCase();
    if (key && names.has(key)) bad(`meta.name "${m.name}" is also the name of ${names.get(key)}`);
    if (key) names.set(key, g.type);
  }
}

// ---- Wrong moves --------------------------------------------------------------------------------

const noWrong = everyPuzzleType.filter((g) => g.meta.role !== 'intro' && typeof (g as AnyPuzzleType & BotHooks).wrongAction !== 'function');
if (noWrong.length)
  warnings.push(`the clumsy bot cannot test wrong moves for (no wrongAction): ${noWrong.map((g) => g.type).join(', ')}`);

// ---- Practices: every release scene, every level, speak on and off, several seeds -----------------

let practices = 0;
const variety = { puzzles: 0, breaks: 0, practicesWith: 0, worst: 0 };
const typeTotals = new Map<string, number>();
const altStats = new Map<string, number>();
const ignoring = new Map<string, number>();
/** Length by level (seed 1, speak on), per scene. */
const lengthByLevel = new Map<string, number[]>();
const micByLevel = new Map<string, number[]>();
/** Lines under MIN_ANGLES_PER_LINE at level 1, speak on, seed 1: line -> reason. */
const thinLines: string[] = [];
const where = (id: string, level: number, seed: number, speak: boolean) => `--practice ${id} --level ${level} --seed ${seed}${speak ? '' : ' --speak off'}`;

function record(p: ComposedPractice, w: string, speak: boolean): void {
  for (const x of problemsOf(p, speak, counted)) findings.push({ where: w, ...x, sceneId: x.sceneId || p.entries[0]!.sceneId });
  const breaks = varietyBreaks(p.plan.steps, p.plan.coverage.length).length;
  variety.puzzles += p.puzzles.length;
  variety.breaks += breaks;
  if (breaks) variety.practicesWith++;
  variety.worst = Math.max(variety.worst, breaks);
  for (const t of p.puzzles) {
    typeTotals.set(t.type, (typeTotals.get(t.type) ?? 0) + 1);
    const close = altCloseness(t);
    if (close) altStats.set(`${t.type} -> ${t.alt!.type} (${close})`, (altStats.get(`${t.type} -> ${t.alt!.type} (${close})`) ?? 0) + 1);
  }
  for (const t of p.plan.ignoresTarget) ignoring.set(t, (ignoring.get(t) ?? 0) + 1);
  if (speak) speakingOff(p, w);
}

/** Speaking turned off at puzzle k (the header's switch, « Je ne peux pas parler »): the same variety rule. */
function speakingOff(p: ComposedPractice, w: string): void {
  const sceneId = p.entries[0]!.sceneId;
  const lines = p.plan.coverage.length;
  for (let k = 0; k < p.puzzles.length; k++) {
    if (k > 0 && !p.plan.steps.slice(k).some((st) => st.needsMic)) break;
    const steps = speakingOffSteps(p, k, everyPuzzleType);
    const breaks = varietyBreaks(steps, lines);
    if (k === 0) {
      varietyOff.puzzles += steps.length;
      varietyOff.breaks += breaks.length;
      if (breaks.length) varietyOff.practicesWith++;
      varietyOff.worst = Math.max(varietyOff.worst, breaks.length);
    }
    const twice = steps.findIndex((st, i) => i > 0 && st.type === steps[i - 1]!.type);
    const bad = [
      ...(twice > 0 ? [`${steps[twice]!.type} twice in a row at ${twice + 1}`] : []),
      ...(breaks.length > VARIETY_SLACK ? [`${breaks.length} puzzles come too soon after a similar one (at most ${VARIETY_SLACK}): ${breaks.slice(0, 4).join('; ')}`] : []),
    ];
    if (bad.length) {
      findings.push({ where: w, sceneId, message: `policy, speaking turned off at puzzle ${k + 1}: ${bad.join('; ')}` });
      return;
    }
  }
}

for (const scene of releaseScenes) {
  const lengths: number[] = [];
  const mics: number[] = [];
  for (const level of LEVELS) {
    for (const speak of [true, false]) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const input = { id: `practice:${scene.id}:${level}`, seed, scene, level, speak, bank: index.bank, others: [] };
        const p = composePractice(input, counted);
        practices++;
        const w = where(scene.id, level, seed, speak);
        record(p, w, speak);
        if (seed === 1 && speak) {
          lengths.push(p.puzzles.length);
          mics.push(p.plan.steps.filter((x) => x.needsMic).length);
          const again = composePractice(input, everyPuzzleType);
          if (JSON.stringify(again.puzzles) !== JSON.stringify(p.puzzles))
            findings.push({ where: w, sceneId: scene.id, message: 'composing the same practice twice gave different puzzles' });
          if (level === 1)
            for (const c of p.plan.coverage)
              if (c.angles < MIN_ANGLES_PER_LINE) thinLines.push(`${c.lineId} ${c.angles} angles (${c.shortfall ?? 'no reason'})`);
        }
      }
    }
  }
  lengthByLevel.set(scene.id, lengths);
  micByLevel.set(scene.id, mics);
}

// ---- Report ------------------------------------------------------------------------------------

const ms = Math.round(performance.now() - t0);
const sorted = (xs: number[]) => xs.slice().sort((a, b) => a - b);
const pct = (xs: number[], p: number) => sorted(xs)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;

console.log(
  `check:practices: ${releaseScenes.length} ${releaseIds ? 'release' : 'bundle'} scenes (bundle ${scenes.length}), ${everyPuzzleType.length} puzzle types, ` +
    `composer v${COMPOSER_VERSION}, media ${checkMedia ? `${mediaChecked} files checked` : 'skipped'}`,
);
console.log(`  composed: ${practices} practices (levels 1-6, speak on/off, ${SEEDS} seeds); microphone spacing: at most ${MIC_PER_WINDOW} in any ${MIC_WINDOW}, never two in a row`);
console.log(
  `  variety (one type ${TYPE_GAP}, one line ${LINE_GAP} or the scene's lines, one unit ${UNIT_GAP} positions apart; at most ${VARIETY_SLACK} puzzles a practice too soon): ` +
    `${variety.breaks} of ${variety.puzzles} puzzles too soon, in ${variety.practicesWith} practices, at most ${variety.worst} in one`,
);
console.log(
  `  the same, speaking turned off at puzzle 1 of a practice composed with it on (every later puzzle checked too): ` +
    `${varietyOff.breaks} of ${varietyOff.puzzles} puzzles too soon, in ${varietyOff.practicesWith} practices, at most ${varietyOff.worst} in one`,
);
console.log(
  '  level table (meaning rebuild say units context): ' +
    Object.entries(LEVEL_ANGLES).map(([l, r]) => `L${l} ${r.meaning}${r.rebuild}${r.say}${r.units}${r.context}`).join(', '),
);
const lv = (i: number) => [...lengthByLevel.values()].map((xs) => xs[i] ?? 0);
console.log('  practice length by level, speak on (median / min / max puzzles; median microphone puzzles):');
LEVELS.forEach((level, i) => {
  const micAt = [...micByLevel.values()].map((xs) => xs[i] ?? 0);
  console.log(`    level ${level}: ${pct(lv(i), 0.5)} / ${pct(lv(i), 0)} / ${pct(lv(i), 1)}; ${pct(micAt, 0.5)} microphone`);
});
const totals = [...lengthByLevel].map(([id, xs]) => ({ id, n: xs[0] ?? 0, lines: sceneMap.get(id)!.lines.length }));
const fewest = totals.reduce((a, b) => (b.n < a.n ? b : a), totals[0]!);
const most = totals.reduce((a, b) => (b.n > a.n ? b : a), totals[0]!);
if (totals.length)
  console.log(`  level 1: fewest puzzles ${fewest.id} (${fewest.n}, ${fewest.lines} lines); most ${most.id} (${most.n}, ${most.lines} lines)`);
const never = everyPuzzleType.filter((g) => !typeTotals.has(g.type)).map((g) => g.type);
console.log('  puzzles by type: ' + [...typeTotals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`  types that never appear: ${never.join(', ') || 'none'}`);
console.log(
  '  build returned null: ' +
    everyPuzzleType
      .map((g) => {
        const c = buildCalls.get(g.type) ?? 0;
        const n = buildNulls.get(g.type) ?? 0;
        return `${g.type} ${c ? Math.round((100 * n) / c) : 0}%`;
      })
      .join(', '),
);
console.log('  microphone rounds replaced when the kid cannot speak: ' + [...altStats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`  puzzle types that ignored a target line (practices where it happened): ${[...ignoring].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
console.log(`  lines under ${MIN_ANGLES_PER_LINE} angles at level 1 (no puzzle type can serve them): ${thinLines.length}`);
for (const l of thinLines.slice(0, 12)) console.log(`    ${l}`);
for (const w of warnings) console.log(`  warning: ${w}`);
const panono = sceneMap.get(PANONO);
if (panono && !flag('--no-panono')) printPlan(composePractice({ id: 'panono', seed: 1, scene: panono, level: 1, speak: true, bank: index.bank, others: [] }));

if (findings.length) {
  console.log(`\n${findings.length} problems${findings.length > MAX_LISTED ? `, first ${MAX_LISTED}` : ''}:`);
  for (const f of findings.slice(0, MAX_LISTED)) {
    const puzzle = f.puzzleId ? ` ${f.puzzleId}` : '';
    const type = f.type ? ` [${f.type}]` : '';
    console.log(`  ${f.sceneId || '-'}${puzzle}${type}: ${f.message}\n      replay: ${f.where}`);
  }
}
console.log(`summary: ${practices} practices, ${findings.length} problems, ${warnings.length} warnings, ${(ms / 1000).toFixed(1)} s`);
process.exit(findings.length ? 1 : 0);
