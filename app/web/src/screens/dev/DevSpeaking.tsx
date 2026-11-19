// /dev/speaking: a lab to try speech recognition with your own voice. Pick a target (a unit, a line or
// an alternate of any scene; the Panono scene first, and a list of known traps), hear the model,
// record, and see for each try: what Whisper heard with the hint on (and off, side by side, when
// "compare" is ticked), the per-word matches, the score, pass or not, the time each call took, and
// what the kid would have seen (the speaking panel's rules: partial credit that builds, the third try
// always passes). Buttons run the three microphone puzzles on the chosen target. "Copy results" gives
// the session as plain text. Plain English (dev tooling); works on an iPad (one tap per take).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { SpeechQuery, SpeechResponse } from '../../../../shared/api';
import type { ContentIndex, Scene } from '../../../../shared/content';
import { alternatesOf } from '../../../../shared/puzzles/say-choice';
import { mergeLit } from '../../../../shared/puzzles/speak-core';
import { SPEECH_MAX_TRIES } from '../../../../shared/rules';
import { loadIndex, loadScene } from '../../api';
import { audio } from '../../audio';
import { loopWindowFor, lineWindow } from '../../scene/timing';
import { askSpeech, encodeWav, isNotice, MicControl, MicNotice, useRecorder, type Take } from '../../speech';
import { Button, Card, Spinner } from '../../ui';
import { DevShell, Tag } from './devParts';

const PANONO = 's01e03-0023-0026';

/** Known traps for recognition: homophones, endings, the show's names, one-syllable words. */
const TRAP_WORDS = ['vert', 'vers', 'pain', 'pin', 'ont', 'on', "c'est", 'ses', 'ces', 'mer', 'mère', 'sang', 'cent', 'ils ont', 'mangez', 'mangé', 'manger', 'les enfants', 'Obélix', 'Astérix', 'Toutatis', 'Panoramix', 'Idéfix', 'Assez', 'oui', 'non', 'bon', 'feu'];

interface Target {
  key: string; // unique in the list
  label: string;
  kind: 'unit' | 'line' | 'alt' | 'choice';
  sceneId: string;
  query: Omit<SpeechQuery, 'hint' | 'attempt' | 'debug'>;
  fr: string;
  en: string;
  lineId: string;
  unitId?: string;
  play: (scene: Scene) => void; // the model
}

interface Call {
  hint: 'expected' | 'names';
  ms: number; // round trip seen by the page
  res?: SpeechResponse;
  error?: string;
}

interface Row {
  n: number; // try number on this target
  target: Target;
  calls: Call[];
  kid: string; // what the kid would have seen
  when: string;
  /** The client's voice gate on this take (web/src/speech/wav.ts): in the puzzles, a take without a voice is never sent. */
  gate: string;
}

function targetsOf(scene: Scene): Target[] {
  const out: Target[] = [];
  for (const line of scene.lines) {
    const w = lineWindow(line);
    out.push({
      key: `line:${line.id}`,
      label: `line ${line.id}`,
      kind: 'line',
      sceneId: scene.id,
      query: { scene: scene.id, line: line.id },
      fr: line.fr,
      en: line.en,
      lineId: line.id,
      play: (sc) => audio.playRange(sc.audio.src, w.startMs, w.endMs, { loop: false }),
    });
    for (const u of line.units) {
      const uw = loopWindowFor(line, u);
      out.push({
        key: `unit:${u.id}`,
        label: `unit ${u.id}${u.key ? '' : ' (not key)'}${line.approxTimes ? ' (approx times)' : ''}`,
        kind: 'unit',
        sceneId: scene.id,
        query: { scene: scene.id, unit: u.id },
        fr: u.fr,
        en: u.en,
        lineId: line.id,
        unitId: u.id,
        play: (sc) => audio.playRange(sc.audio.src, uw.startMs, uw.endMs, { loop: false }),
      });
    }
    const alts = alternatesOf(line);
    alts.forEach((a, k) => {
      out.push({
        key: `alt:${line.id}:${k}`,
        label: `alternate ${k} of ${line.id}`,
        kind: 'alt',
        sceneId: scene.id,
        query: { scene: scene.id, alt: `${line.id}:${k}` },
        fr: a.fr,
        en: a.en,
        lineId: line.id,
        play: () => (a.audio ? audio.play(a.audio) : undefined),
      });
    });
    if (alts.length) {
      out.push({
        key: `choice:${line.id}`,
        label: `choice among ${line.id} and its ${alts.length} alternates`,
        kind: 'choice',
        sceneId: scene.id,
        query: { scene: scene.id, choice: line.id },
        fr: [line.fr, ...alts.map((a) => a.fr)].join('  |  '),
        en: [line.en, ...alts.map((a) => a.en)].join('  |  '),
        lineId: line.id,
        play: (sc) => audio.playRange(sc.audio.src, w.startMs, w.endMs, { loop: false }),
      });
    }
  }
  return out;
}

/** A label and its control, side by side when there is room, stacked on a phone. */
function row(label: string, control: ReactNode): ReactNode {
  return (
    <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 700, flex: '1 1 140px', maxWidth: 220 }}>{label}</span>
      <span style={{ flex: '999 1 240px', minWidth: 0, display: 'flex' }}>{control}</span>
    </label>
  );
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’]/g, "'");
}

/** For each trap word, the first unit of the bundle whose French is that word (or starts with it). */
async function findTraps(index: ContentIndex): Promise<{ word: string; sceneId: string; unitId: string; fr: string }[]> {
  const found = new Map<string, { word: string; sceneId: string; unitId: string; fr: string }>();
  for (const sc of index.scenes) {
    if (found.size === TRAP_WORDS.length) break;
    const scene = await loadScene(sc.id);
    for (const line of scene.lines)
      for (const u of line.units)
        for (const w of TRAP_WORDS) {
          if (found.has(w)) continue;
          const f = fold(u.fr).replace(/[^\p{L}' ]+/gu, ' ').trim();
          if (f === fold(w) || f.startsWith(fold(w) + ' ')) found.set(w, { word: w, sceneId: scene.id, unitId: u.id, fr: u.fr });
        }
  }
  return [...found.values()];
}

/** What the speaking panel would have shown the kid for this try. */
function kidView(target: Target, n: number, call: Call | undefined, litBefore: boolean[]): { text: string; lit: boolean[] } {
  if (!call?.res) return { text: `no verdict (${call?.error ?? '?'}) -> listen-back: the original, then their voice, "c'est moi !"`, lit: litBefore };
  const r = call.res;
  if (target.kind === 'choice') {
    const c = r.choice;
    if (r.pass && c) return { text: `balloon ${c.index} wins (${c.index === 0 ? 'the real line' : 'a funny one'})`, lit: litBefore };
    if (n >= SPEECH_MAX_TRIES) return { text: `third try: the closest wins (balloon ${c ? c.scores.indexOf(Math.max(...c.scores)) : 0})`, lit: litBefore };
    return { text: 'nothing recognised: "dis-la encore", and the balloons get "Celle-là !" buttons', lit: litBefore };
  }
  const lit = mergeLit(litBefore, r.matched);
  if (r.pass) return { text: `PASS: celebration (decided by ${r.by ?? '?'})`, lit };
  if (lit.length && lit.every(Boolean)) return { text: 'PASS: every word heard across the tries', lit };
  if (n >= SPEECH_MAX_TRIES) return { text: 'PASS (third try, auto-accepted without waiting for the server): the same celebration', lit };
  const missing = r.matched.filter((_, i) => !lit[i]).map((m) => m.word);
  return { text: `not yet: heard "${r.transcript}"; still to say: ${missing.join(' ')}; the missing piece replays, then the whole target`, lit };
}

export default function DevSpeakingScreen() {
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [sceneId, setSceneId] = useState(PANONO);
  const [scene, setScene] = useState<Scene | null>(null);
  const [targetKey, setTargetKey] = useState<string>('');
  const [compare, setCompare] = useState(true);
  const [typed, setTyped] = useState(''); // a transcript instead of the microphone (TEST_MODE servers only)
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [traps, setTraps] = useState<{ word: string; sceneId: string; unitId: string; fr: string }[] | null>(null);
  const [trapsLoading, setTrapsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const litRef = useRef(new Map<string, boolean[]>());
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void loadIndex().then(setIndex);
  }, []);
  useEffect(() => {
    setScene(null);
    void loadScene(sceneId).then((sc) => {
      setScene(sc);
      void audio.preload(sc.audio.src);
    });
  }, [sceneId]);

  const targets = useMemo(() => (scene ? targetsOf(scene) : []), [scene]);
  const target = targets.find((x) => x.key === targetKey) ?? targets[0];
  const triesOn = (t: Target) => rows.filter((r) => r.target.key === t.key).length;

  const run = async (take: Take | null) => {
    if (!target || !scene) return;
    setBusy(true);
    const n = triesOn(target) + 1;
    const wav = take?.wav ?? new Blob([encodeWav(new Float32Array(8000))], { type: 'audio/wav' }); // half a second of silence
    const hints: Call['hint'][] = compare ? ['expected', 'names'] : ['expected'];
    const transcript = typed.trim() ? typed.trim() : undefined;
    const calls = await Promise.all(
      hints.map(async (hint): Promise<Call> => {
        const r = await askSpeech({ ...target.query, hint, attempt: n, debug: true }, wav, transcript);
        return 'error' in r ? { hint, ms: r.ms, error: r.error } : { hint, ms: r.ms, res: r.res };
      }),
    );
    if (take) URL.revokeObjectURL(take.url);
    const before = litRef.current.get(target.key) ?? [];
    const kv = kidView(target, n, calls[0], before);
    litRef.current.set(target.key, kv.lit);
    const gate = !take ? 'typed' : take.problem === 'silent' ? 'no voice: not sent in a puzzle' : take.problem === 'short' ? 'too short: not sent in a puzzle' : `voice (${(take.durationMs / 1000).toFixed(1)} s after trimming)`;
    setRows((rs) => [{ n, target, calls, kid: kv.text, when: new Date().toLocaleTimeString(), gate }, ...rs]);
    setBusy(false);
  };

  const rec = useRecorder((take) => void run(take));
  const press = () => {
    if (busy || rec.status !== 'idle') return;
    audio.stop();
    if (typed.trim()) void run(null);
    else rec.record(target && target.kind !== 'unit' ? 20000 : 7000, target?.kind === 'unit' ? { silenceMs: 800 } : { silenceMs: 1500 });
  };

  const exportText = () => {
    const lines = [`Frenchirix speaking lab, ${new Date().toISOString()}`, ''];
    for (const r of [...rows].reverse()) {
      lines.push(`[${r.when}] try ${r.n} on ${r.target.label}: "${r.target.fr}"`);
      for (const c of r.calls) {
        if (!c.res) {
          lines.push(`  hint=${c.hint}: ERROR ${c.error} (${c.ms} ms)`);
          continue;
        }
        const m = c.res.matched.map((w) => (w.ok ? w.word : `[${w.word}]`)).join(' ');
        lines.push(`  hint=${c.hint}: heard "${c.res.transcript}" | words ${m} | score ${c.res.score.toFixed(2)} | ${c.res.pass ? 'PASS' : 'fail'}${c.res.choice ? ` | choice ${c.res.choice.index} scores ${c.res.choice.scores.map((x) => x.toFixed(2)).join('/')}` : ''} | ${c.ms} ms page, ${c.res.debug?.ms ?? '?'} ms model`);
        const d = c.res.debug;
        lines.push(`    decided by: ${c.res.by ?? d?.by ?? '?'}${d ? ` | Whisper ${d.ms} ms | total ${d.totalMs ?? '?'} ms` : ''}`);
        if (d?.judge) {
          const v = d.judge.verdict;
          lines.push(`    judge ${d.judge.model}: ${d.judge.ms} ms, prompt ${d.judge.promptChars} chars, verdict ${v ? `attempt=${v.attempt} candidate=${v.candidate}` : 'none'}${d.judge.error ? `, error ${d.judge.error}` : ''}, raw "${d.judge.raw}"`);
        }
        if (d) lines.push(`    prompt: ${d.hint}`);
      }
      lines.push(`  kid sees: ${r.kid}`);
      lines.push(`  client voice gate: ${r.gate}`);
    }
    const text = lines.join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
    const w = window.open('', '_blank');
    if (w) {
      w.document.body.innerText = text;
      w.document.body.style.whiteSpace = 'pre-wrap';
      w.document.body.style.fontFamily = 'monospace';
    }
  };

  const puzzleLink = (puzzleType: string) => {
    if (!target) return '#';
    const q = new URLSearchParams({ scene: target.sceneId, type: puzzleType, level: '2', seed: '1' });
    if (puzzleType === 'say-chain') {
      if (target.unitId) q.set('unit', target.unitId);
    } else q.set('line', target.lineId);
    return `/dev/practice?${q}`;
  };

  const notice = isNotice(rec.status);
  return (
    <DevShell title="Speaking lab" back>
      <Card style={{ minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gap: 10, minWidth: 0, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {row(
            'Scene',
            <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} style={{ minHeight: 44, fontSize: 16, width: '100%', minWidth: 0 }}>
              {index?.scenes.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.id === PANONO ? '★ ' : ''}
                  {sc.id} · {sc.titleFr}
                </option>
              ))}
            </select>,
          )}
          {row(
            'Target',
            scene ? (
              <select value={target?.key ?? ''} onChange={(e) => setTargetKey(e.target.value)} style={{ minHeight: 44, fontSize: 16, width: '100%', minWidth: 0 }} data-lab-target>
                {targets.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}: {x.fr.replace(/\n/g, ' / ')}
                  </option>
                ))}
              </select>
            ) : (
              <Spinner size="sm" />
            ),
          )}
          {row(
            'Traps',
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {!traps && (
                <Button
                  size="sm"
                  color="white"
                  loading={trapsLoading}
                  onClick={() => {
                    if (!index) return;
                    setTrapsLoading(true);
                    void findTraps(index).then((x) => {
                      setTraps(x);
                      setTrapsLoading(false);
                    });
                  }}
                >
                  Find trap words in the bundle
                </Button>
              )}
              {traps?.map((tr) => (
                <Button
                  key={tr.word}
                  size="sm"
                  color="white"
                  onClick={() => {
                    setSceneId(tr.sceneId);
                    setTargetKey(`unit:${tr.unitId}`);
                  }}
                >
                  {tr.fr}
                </Button>
              ))}
            </div>,
          )}
          {target && (
            <div style={{ padding: 10, border: '3px solid var(--ink)', background: 'var(--white)' }}>
              <div style={{ fontSize: 22, fontWeight: 800 }} lang="fr">
                {target.fr}
              </div>
              <div style={{ fontSize: 15 }} lang="en">
                {target.en}
              </div>
              <div style={{ marginTop: 6 }}>
                <Tag>{target.kind}</Tag>
                <Tag>tries on this target: {triesOn(target)}</Tag>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Button color="yellow" icon="speaker" onClick={() => scene && target?.play(scene)}>
              Hear the model
            </Button>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} style={{ width: 24, height: 24 }} />
              Compare hint on / off (two calls)
            </label>
          </div>
          {row(
            'Typed transcript (optional)',
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="instead of the microphone (servers in TEST_MODE only)" style={{ minHeight: 44, fontSize: 16, padding: '4px 8px', border: '3px solid var(--ink)', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />,
          )}
          {notice ? (
            <MicNotice status={rec.status} onOk={rec.acceptIntro} onSkip={rec.reset} onRetry={rec.reset} />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <MicControl rec={rec} refEl={btnRef} onStart={press} onPause={rec.pause} thinking={busy} idle={rows.length > 0 ? 'again' : 'start'} />
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 800, alignSelf: 'center' }}>Run a puzzle on this target:</span>
            {['act-line', 'say-chain', 'say-choice'].map((g) => (
              <Link key={g} href={puzzleLink(g)}>
                <Button size="sm" color="white">
                  {g}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Tries ({rows.length})</h2>
          <Button size="sm" color="white" onClick={exportText} disabled={!rows.length} data-lab-export>
            Copy results as text
          </Button>
          {copied && <Tag color="var(--lime)">copied</Tag>}
          <Button
            size="sm"
            color="white"
            onClick={() => {
              setRows([]);
              litRef.current.clear();
            }}
          >
            Clear
          </Button>
        </div>
        <div style={{ display: 'grid', gap: 12 }} data-lab-rows>
          {rows.map((r, i) => (
            <div key={rows.length - i} style={{ border: '3px solid var(--ink)', background: 'var(--white)', padding: 8 }} data-lab-row>
              <div style={{ fontWeight: 800 }}>
                Try {r.n} · {r.target.label} · {r.when}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))`, gap: 8, marginTop: 6 }}>
                {r.calls.map((c) => (
                  <div key={c.hint} style={{ border: '2px solid var(--ink)', padding: 6, background: c.res?.pass ? '#dff5d0' : 'var(--paper)' }}>
                    <div style={{ fontWeight: 800 }}>
                      hint = {c.hint} · {c.ms} ms{c.res?.debug ? ` (model ${c.res.debug.ms} ms)` : ''}
                    </div>
                    {c.res ? (
                      <>
                        <div>
                          heard: <b>“{c.res.transcript}”</b>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0' }}>
                          {c.res.matched.map((w, k) => (
                            <span key={k} style={{ padding: '1px 6px', border: '2px solid var(--ink)', background: w.ok ? 'var(--lime)' : 'var(--white)', textDecoration: w.ok ? 'none' : 'line-through' }}>
                              {w.word}
                            </span>
                          ))}
                        </div>
                        <div>
                          score {c.res.score.toFixed(2)} · {c.res.pass ? 'PASS' : 'no pass'}
                          {c.res.choice ? ` · choice ${c.res.choice.index} (scores ${c.res.choice.scores.map((x) => x.toFixed(2)).join(' / ')})` : ''}
                        </div>
                        <div>
                          decided by: <b>{c.res.by ?? c.res.debug?.by ?? '?'}</b>
                          {c.res.debug ? ` · Whisper ${c.res.debug.ms} ms · total ${c.res.debug.totalMs ?? '?'} ms` : ''}
                        </div>
                        {c.res.debug?.judge && (
                          <div style={{ fontSize: 13, borderTop: '2px dashed var(--ink)', marginTop: 4, paddingTop: 4 }}>
                            judge {c.res.debug.judge.model} · {c.res.debug.judge.ms} ms · prompt {c.res.debug.judge.promptChars} chars
                            <br />
                            verdict: {c.res.debug.judge.verdict ? `attempt ${c.res.debug.judge.verdict.attempt ? 'yes' : 'no'}, candidate ${c.res.debug.judge.verdict.candidate}` : 'none'}
                            {c.res.debug.judge.error ? ` · error: ${c.res.debug.judge.error}` : ''}
                            <br />
                            raw: “{c.res.debug.judge.raw}”
                          </div>
                        )}
                        {c.res.debug && <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>prompt: {c.res.debug.hint}</div>}
                      </>
                    ) : (
                      <div>error: {c.error}</div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 6 }}>
                <b>Kid sees:</b> {r.kid} · <b>Voice gate:</b> {r.gate}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </DevShell>
  );
}
