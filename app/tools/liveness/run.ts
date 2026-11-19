// `npm run check:liveness`: the liveness check for stuck puzzles (docs/checks.md, "check:liveness").
// Runs the explorer (web/src/testing/liveness.explore.tsx, its own Vitest config), groups the runs
// that did not end well into findings by signature, compares them with the ledger
// (tools/liveness/ledger.json) and writes test-results/liveness.json. The puzzle types are shared
// among up to four vitest processes in parallel.
//
//   npm run check:liveness                                   every puzzle type, every scenario
//   npm run check:liveness -- --type say-chain               one puzzle type (or a,b,c)
//   npm run check:liveness -- --type say-chain --seed 1003 --scenario random   replay one run, with its log
//   npm run check:liveness -- --data <dir>                   another bundle (default public/data)
//   npm run check:liveness -- --record-open                  add every new finding to the ledger as open
//
// Exit status: 0 when every finding is in the ledger as open or not-a-bug; 1 when a finding is new
// (absent from the ledger) or a regression (in it as fixed); 2 when the check itself failed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Run, RunKind } from '../../web/src/testing/liveness-types';

const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ledgerPath = join(appDir, 'tools/liveness/ledger.json');
// LIVENESS_RESULTS_DIR: where the report and the shards' raw results go (default app/test-results), so
// agents running the check at the same time do not overwrite each other's files.
const resultsDir = process.env.LIVENESS_RESULTS_DIR ? resolve(process.env.LIVENESS_RESULTS_DIR) : join(appDir, 'test-results');
const reportPath = join(resultsDir, 'liveness.json');

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(name);
const known = new Set(['--type', '--seed', '--scenario', '--data', '--record-open']);
for (const a of argv) {
  if (a.startsWith('--') && !known.has(a)) {
    console.error(`check:liveness: unknown option ${a} (options: ${[...known].join(', ')})`);
    process.exit(2);
  }
}
const type = arg('--type');
const seed = arg('--seed');
const scenario = arg('--scenario');
const replaying = seed !== undefined;
if (replaying && !type) {
  console.error('check:liveness: --seed replays one run and needs --type');
  process.exit(2);
}

export type LedgerStatus = 'open' | 'fixed' | 'not-a-bug';
export interface LedgerEntry {
  status: LedgerStatus;
  date: string; // YYYY-MM-DD of the verdict
  note: string;
  commit?: string;
}
type Ledger = Record<string, LedgerEntry>;

function fail(msg: string, detail?: string): never {
  console.error(`check:liveness: ${msg}`);
  if (detail) console.error(detail);
  process.exit(2);
}

// ---- Run the explorer -----------------------------------------------------------------------------

const t0 = performance.now();
const vitest = join(appDir, 'node_modules/.bin/vitest');
if (!existsSync(vitest)) fail('app/node_modules is missing (cd app && npm ci)');
// The explorer plays real scenes: without a bundle (a clone without content) the check cannot run.
const dataDir = arg('--data') ? resolve(arg('--data')!) : join(appDir, 'public/data');
if (!existsSync(join(dataDir, 'index.json'))) fail(`no content bundle at ${dataDir}, and the check plays real scenes. Build it from the repository root with:  .venv/bin/frenchirix export-app --data-only`);
// Shards: one vitest process per share of the puzzle types, in parallel (one when replaying a run).
const shards = replaying ? 1 : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2), type ? type.split(',').length : 4));
const rawPath = (k: number) => join(resultsDir, `liveness.raw.${k}.json`);

function explore(k: number): Promise<{ status: number | null; output: string }> {
  rmSync(rawPath(k), { force: true });
  return new Promise((done) => {
    const child = spawn(vitest, ['run', '--config', 'tools/liveness/vitest.config.ts', '--reporter=dot'], {
      cwd: appDir,
      env: {
        ...process.env,
        NO_COLOR: '1',
        LIVENESS_OUT: rawPath(k),
        LIVENESS_SHARD: `${k}/${shards}`,
        ...(type ? { LIVENESS_TYPE: type } : {}),
        ...(seed ? { LIVENESS_SEED: seed } : {}),
        ...(scenario ? { LIVENESS_SCENARIO: scenario } : {}),
        ...(arg('--data') ? { LIVENESS_DATA: resolve(arg('--data')!) } : {}),
      },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (e) => done({ status: null, output: `could not start vitest: ${e.message}` }));
    child.on('close', (status) => done({ status, output }));
  });
}

const results = await Promise.all(Array.from({ length: shards }, (_, k) => explore(k)));
const seconds = Math.round((performance.now() - t0) / 1000);
const raw: { types: string[]; runs: Run[] } = { types: [], runs: [] };
for (const [k, r] of results.entries()) {
  if (r.status !== 0 || !existsSync(rawPath(k))) fail(`the explorer failed (vitest exit ${r.status}):`, r.output.trim().split('\n').slice(-40).join('\n'));
  try {
    const part = JSON.parse(readFileSync(rawPath(k), 'utf8')) as typeof raw;
    raw.types.push(...part.types);
    raw.runs.push(...part.runs);
  } catch (e) {
    fail(`unreadable results in ${rawPath(k)}: ${String(e)}`);
  }
}

let ledger: Ledger = {};
if (existsSync(ledgerPath)) {
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
  } catch (e) {
    fail(`the ledger ${ledgerPath} is not valid JSON: ${String(e)}`);
  }
}

// ---- Findings -------------------------------------------------------------------------------------

interface Finding {
  signature: string;
  type: string;
  kind: RunKind;
  status: 'new' | 'regression' | LedgerStatus;
  ledger: LedgerEntry | null;
  runs: number;
  replay: string;
  example: Run;
  others: { scenario: string; seed: number }[];
}

const replayOf = (r: Run) => `npm run check:liveness -- --type ${r.type} --seed ${r.seed} --scenario ${r.scenario}`;
const bad = raw.runs.filter((r) => r.kind !== 'done' && r.kind !== 'no-build');
const bySig = new Map<string, Run[]>();
for (const r of bad) bySig.set(r.signature, [...(bySig.get(r.signature) ?? []), r]);
const findings: Finding[] = [...bySig.entries()]
  .map(([signature, runs]) => {
    // The example to replay: the shortest run (fewest taps, then fixed scenarios, then the lowest seed).
    const sorted = [...runs].sort((a, b) => a.steps - b.steps || Number(a.scenario === 'random') - Number(b.scenario === 'random') || a.seed - b.seed);
    const ex = sorted[0]!;
    const entry = ledger[signature] ?? null;
    const status: Finding['status'] = !entry ? 'new' : entry.status === 'fixed' ? 'regression' : entry.status;
    return { signature, type: ex.type, kind: ex.kind, status, ledger: entry, runs: runs.length, replay: replayOf(ex), example: ex, others: sorted.slice(1, 6).map((r) => ({ scenario: r.scenario, seed: r.seed })) };
  })
  .sort((a, b) => a.type.localeCompare(b.type) || a.signature.localeCompare(b.signature));

const failing = findings.filter((f) => f.status === 'new' || f.status === 'regression');
// Open entries of the puzzle types that ran, no longer seen in a full run: probably fixed.
const fullRun = !replaying && !scenario;
const unseen = fullRun ? Object.entries(ledger).filter(([sig, e]) => e.status === 'open' && raw.types.includes(sig.split(' ')[0]!) && !bySig.has(sig)).map(([sig]) => sig) : [];
const noBuild = [...new Set(raw.runs.filter((r) => r.kind === 'no-build').map((r) => r.type))];

// ---- Report ---------------------------------------------------------------------------------------

mkdirSync(dirname(reportPath), { recursive: true });
const fakeMs = raw.runs.reduce((n, r) => n + r.ms, 0);
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      seconds,
      runs: raw.runs.length,
      types: raw.types,
      kinds: Object.fromEntries([...new Set(raw.runs.map((r) => r.kind))].map((k) => [k, raw.runs.filter((r) => r.kind === k).length])),
      findings: findings.map(({ example, ...f }) => ({ ...f, example: { ...example } })),
      unseenOpen: unseen,
      noBuild,
    },
    null,
    1,
  ),
);

if (replaying) {
  for (const r of raw.runs) {
    console.log(`${r.type} ${r.scenario} seed ${r.seed}: ${r.kind} after ${r.steps} taps and ${Math.round(r.ms / 1000)} s of fake time (scene ${r.sceneId}, level ${r.level}, ${r.layout})`);
    console.log(`  state: ${r.state}`);
    console.log(`  controls: ${r.controls}`);
    if (r.escape !== 'none') console.log(`  "Je ne peux pas parler" at the end: ${r.escape === 'works' ? 'gets the kid out' : 'does not get the kid out'}`);
    if (r.error) console.log(`  error: ${r.error}`);
    console.log('  log (fake ms, then each outcome drawn and each tap; all of it in test-results/liveness.json):');
    const log = r.log.length > 120 ? [...r.log.slice(0, 60), `… ${r.log.length - 120} lines …`, ...r.log.slice(-60)] : r.log;
    for (const l of log) console.log(`    ${l}`);
  }
}

const label: Record<Finding['status'], string> = { new: 'NEW', regression: 'REGRESSION', open: 'open', 'not-a-bug': 'not-a-bug', fixed: 'fixed' };
for (const f of findings) {
  const note = f.ledger?.note ?? '';
  const why = f.ledger ? ` [ledger ${f.ledger.date}: ${note.length > 90 ? `${note.slice(0, 89)}…` : note}]` : '';
  console.log(`${label[f.status]}: ${f.signature}${why}`);
  console.log(`    ${f.runs} run${f.runs === 1 ? '' : 's'}; replay: ${f.replay}`);
}
for (const sig of unseen) console.log(`unseen: ${sig} [open in the ledger, not found this run: fixed? mark it so after checking]`);
if (noBuild.length) console.log(`note: no scene built a puzzle of ${noBuild.join(', ')}`);

const counts = (s: Finding['status']) => findings.filter((f) => f.status === s).length;
console.log(
  `summary: ${raw.runs.length} run${raw.runs.length === 1 ? '' : 's'} of ${raw.types.length} puzzle type${raw.types.length === 1 ? '' : 's'} in ${seconds} s (${Math.round(fakeMs / 60_000)} min of fake time); ` +
    `${findings.length} finding${findings.length === 1 ? '' : 's'}: ${counts('new')} new, ${counts('regression')} regression${counts('regression') === 1 ? '' : 's'}, ${counts('open')} open, ${counts('not-a-bug')} not-a-bug. Report: test-results/liveness.json`,
);

if (flag('--record-open') && failing.length) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const f of failing) ledger[f.signature] = { status: 'open', date: today, note: `found ${today}; to investigate (${f.runs} runs; ${f.replay.replace('npm run check:liveness -- ', '')})` };
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(ledgerPath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`recorded ${failing.length} findings in tools/liveness/ledger.json as open`);
  process.exit(0);
}
process.exit(failing.length ? 1 : 0);
