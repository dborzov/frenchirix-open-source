// /dev/loops: listen to the loop styles (audio/loopStyle.ts) on real units and pick the best.
//   /dev/loops?src=s01e03-0019-0022            a scene (or a song id) to take units from
// A unit keeps looping while the style or the numbers change. The waveform shows the unit window,
// the padding, the cut points and the fade curves; the parameter line can be copied and sent back.
// Dev tooling: plain English, not translated.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { Line, Unit } from '../../../../shared/content';
import { loadIndex, loadScene, loadSong } from '../../api';
import { audio, useAudioState } from '../../audio';
import { DEFAULT_LOOP_STYLE, envelopeAt, LOOP_STYLES, measureSeams, planLoop, rmsDb, type LoopStyle, type LoopStyleId, type SeamReport } from '../../audio/loopStyle';
import { loopWindowFor } from '../../scene/timing';
import { Button, Card } from '../../ui';

const IDS: LoopStyleId[] = ['A', 'B', 'C', 'D', 'E'];
const DESCRIBE: Record<LoopStyleId, string> = {
  A: 'today: the window, 8 ms linear fades',
  B: 'same window, shaped fades inside it',
  C: 'padded window, fades in the padding',
  D: 'C + cuts moved to the quietest moment',
  E: 'D + long soft release, longer gap',
};
const DEFAULT_SRC = 's01e03-0019-0022';

interface Source {
  id: string;
  title: string;
  audioSrc: string;
  lines: Line[];
}

function paramLine(st: LoopStyle, unit: Unit | null): string {
  const p: string[] = [st.id];
  if (st.id === 'A' || st.id === 'B') p.push(`in ${st.fadeInMs}`, `out ${st.fadeOutMs}`);
  else p.push(`pre ${st.preMs}`, `post ${st.postMs}`);
  if (st.id === 'E') p.push(`release ${st.releaseMs}`, `lowpass ${st.lowpass ? 'on' : 'off'}`);
  p.push(`gap ${st.gapMs}`);
  if (unit) p.push(`unit ${unit.id} "${unit.fr}"`);
  return p.join(', ');
}

/** Short, hard units first: "tout va bien" if present, then 2-3 word expressions, shortest first. */
function rankUnits(lines: Line[]): { unit: Unit; line: Line }[] {
  const all = lines.flatMap((line) => line.units.map((unit) => ({ unit, line })));
  const score = ({ unit, line }: { unit: Unit; line: Line }) => {
    const n = unit.words.length;
    let sc = unit.endMs - unit.startMs;
    if (/tout va bien/i.test(unit.fr)) sc -= 100000;
    if (n >= 2 && n <= 3) sc -= 10000;
    if (line.approxTimes) sc += 50000;
    return sc;
  };
  return all.sort((a, b) => score(a) - score(b));
}

let decodeCtx: OfflineAudioContext | null = null;
const decoded = new Map<string, Promise<AudioBuffer>>();
function decode(src: string): Promise<AudioBuffer> {
  let p = decoded.get(src);
  if (!p) {
    decodeCtx ??= new OfflineAudioContext(2, 1, 48000);
    const ctx = decodeCtx;
    p = fetch(src)
      .then((r) => r.arrayBuffer())
      .then((d) => new Promise<AudioBuffer>((res, rej) => void ctx.decodeAudioData(d, res, rej)));
    decoded.set(src, p);
  }
  return p;
}

export default function DevLoopsScreen() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const srcId = new URLSearchParams(search).get('src') ?? DEFAULT_SRC;
  const [choices, setChoices] = useState<{ id: string; label: string }[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [sel, setSel] = useState<{ unit: Unit; line: Line } | null>(null);
  const [styleId, setStyleId] = useState<LoopStyleId>(DEFAULT_LOOP_STYLE);
  const [params, setParams] = useState<Record<LoopStyleId, LoopStyle>>(() => structuredClone(LOOP_STYLES));
  const [report, setReport] = useState<{ seams: SeamReport[]; beforeEndDb: number; afterStartDb: number; insideDb: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const st = useAudioState();
  const style = params[styleId];

  useEffect(() => {
    void loadIndex().then((i) => {
      const songs = i.songs.map((s) => ({ id: s.id, label: `song · ${s.titleFr}` }));
      const scenes = i.scenes.map((s) => ({ id: s.id, label: `${s.id} · ${s.titleFr}` }));
      const tvb = ['s01e03-0019-0022', 's01e03-0023-0026'];
      setChoices([...scenes.filter((s) => tvb.includes(s.id)), ...songs, ...scenes.filter((s) => !tvb.includes(s.id))]);
    });
  }, []);

  useEffect(() => {
    let live = true;
    setSource(null);
    setBuffer(null);
    setSel(null);
    const isSong = !/^s\d\de\d\d-\d{4}-\d{4}$/.test(srcId);
    const p = isSong
      ? loadSong(srcId).then((s) => ({ id: s.id, title: s.titleFr, audioSrc: s.audio.src, lines: s.lines }))
      : loadScene(srcId).then((s) => ({ id: s.id, title: s.titleFr, audioSrc: s.audio.src, lines: s.lines }));
    void p.then((s) => {
      if (!live) return;
      setSource(s);
      void audio.preload(s.audioSrc);
      void decode(s.audioSrc).then((b) => live && setBuffer(b));
    });
    return () => {
      live = false;
      audio.stop();
    };
  }, [srcId]);

  const ranked = useMemo(() => (source ? rankUnits(source.lines) : []), [source]);

  const play = (target = sel, st0 = style) => {
    if (!target || !source) return;
    const w = loopWindowFor(target.line, target.unit);
    audio.playRange(source.audioSrc, w.startMs, w.endMs, { loop: true, tag: `loops:${target.unit.id}`, loopStyle: st0 });
  };

  // Keep looping with the new style or numbers.
  const looping = st.playing && st.tag === (sel ? `loops:${sel.unit.id}` : '');
  useEffect(() => {
    if (looping) play();
    setReport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleId, params]);

  const setP = (k: keyof LoopStyle, v: number | boolean) => setParams((ps) => ({ ...ps, [styleId]: { ...ps[styleId], [k]: v } }));

  const measure = async () => {
    if (!buffer || !sel || !source) return;
    const w = loopWindowFor(sel.line, sel.unit);
    const a = w.startMs / 1000;
    const b = w.endMs / 1000;
    const seams: SeamReport[] = [];
    for (const id of IDS) seams.push(await measureSeams(buffer, a, b, params[id], source.audioSrc));
    setReport({ seams, beforeEndDb: rmsDb(buffer, b - 0.1, b), afterStartDb: rmsDb(buffer, a, a + 0.1), insideDb: rmsDb(buffer, a, b) });
  };

  const line = paramLine(style, sel?.unit ?? null);
  const box = { padding: 12, border: '3px solid var(--ink)', background: 'var(--white)' } as const;
  const slider = (label: string, k: keyof LoopStyle, min: number, max: number, step = 5) => (
    <label key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 64px', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={style[k] as number} onChange={(e) => setP(k, Number(e.target.value))} data-slider={k} style={{ width: '100%', minHeight: 44 }} />
      <b>{String(style[k])} ms</b>
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }} data-dev-loops>
      <Card>
        <h2 style={{ margin: '0 0 8px' }}>Loop styles</h2>
        <select style={{ width: '100%', minHeight: 44, fontSize: 16, border: '3px solid var(--ink)' }} value={srcId} onChange={(e) => navigate(`/dev/loops?src=${encodeURIComponent(e.target.value)}`)} data-src>
          {!choices.some((c) => c.id === srcId) && <option value={srcId}>{srcId}</option>}
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Card>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 }}>
          {IDS.map((id) => (
            <Button key={id} size="lg" block style={{ minWidth: 0, paddingInline: 0 }} color={styleId === id ? 'yellow' : 'white'} onClick={() => setStyleId(id)} data-style={id} aria-pressed={styleId === id}>
              {id}
              {id === DEFAULT_LOOP_STYLE ? '★' : ''}
            </Button>
          ))}
        </div>
        <p style={{ margin: '10px 0 0', fontWeight: 800 }}>
          {styleId}: {DESCRIBE[styleId]}
          {styleId === DEFAULT_LOOP_STYLE ? ' · the app’s default' : ''}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 14 }}>Default for every loop in the app: {DEFAULT_LOOP_STYLE} (★), with the values shown when this page opens.</p>
        <div style={{ marginTop: 8 }}>
          {(styleId === 'A' || styleId === 'B') && [slider('fade in', 'fadeInMs', 2, 150), slider('fade out', 'fadeOutMs', 2, 300)]}
          {styleId !== 'A' && styleId !== 'B' && [slider('pad before', 'preMs', 0, 300), slider('pad after', 'postMs', 0, 400)]}
          {styleId === 'E' && slider('release', 'releaseMs', 50, 500)}
          {slider('gap', 'gapMs', 150, 600, 10)}
          {styleId === 'E' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={style.lowpass} onChange={(e) => setP('lowpass', e.target.checked)} style={{ width: 28, height: 28 }} data-lowpass />
              low-pass during the release
            </label>
          )}
        </div>
        <div style={{ ...box, marginTop: 8, fontFamily: 'monospace', fontSize: 15, wordBreak: 'break-word' }} data-param-line>
          {line}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            color="white"
            onClick={() => {
              void navigator.clipboard?.writeText(line).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? 'copied' : 'copy'}
          </Button>
          <Button size="sm" color={looping ? 'tomato' : 'lime'} icon={looping ? 'stop' : 'play'} onClick={() => (looping ? audio.stop() : play())} disabled={!sel} data-loop-toggle>
            {looping ? 'stop' : 'loop'}
          </Button>
          <Button size="sm" color="white" onClick={() => void measure()} disabled={!buffer || !sel} data-measure>
            measure seams (all styles)
          </Button>
        </div>
      </Card>

      {sel && buffer && <Wave buffer={buffer} unit={sel.unit} line={sel.line} style={style} cacheKey={source?.audioSrc ?? ''} />}

      {report && sel && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 13 }} data-report>
            <thead>
              <tr>
                <th align="left">style</th>
                <th>played ms</th>
                <th>|first|</th>
                <th>|last|</th>
                <th>seam step / max step</th>
                <th>dB last 20 ms</th>
                <th>dB first 20 ms</th>
              </tr>
            </thead>
            <tbody>
              {report.seams.map((r) => (
                <tr key={r.style} style={{ borderTop: '1px solid var(--ink)' }}>
                  <td>{r.style}</td>
                  <td align="center">
                    {r.playMs[0]}–{r.playMs[1]}
                  </td>
                  <td align="center">{r.firstSample.toExponential(1)}</td>
                  <td align="center">{r.lastSample.toExponential(1)}</td>
                  <td align="center">{r.seamStepRatio.toFixed(2)}</td>
                  <td align="center">{r.tailDb.toFixed(1)}</td>
                  <td align="center">{r.headDb.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '8px 0 0', fontSize: 14 }}>
            Source level, unit window: last 100 ms {report.beforeEndDb.toFixed(1)} dB, first 100 ms {report.afterStartDb.toFixed(1)} dB, whole {report.insideDb.toFixed(1)} dB.
          </p>
        </Card>
      )}

      <Card>
        <h3 style={{ margin: '0 0 8px' }}>{source?.title ?? '…'}: units, short and hard first</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ranked.map(({ unit, line: l }) => (
            <Button
              key={unit.id}
              size="sm"
              color={sel?.unit.id === unit.id ? 'yellow' : 'white'}
              onClick={() => {
                const t = { unit, line: l };
                setSel(t);
                setReport(null);
                play(t);
              }}
              data-unit-pick={unit.id}
            >
              {unit.fr} · {unit.endMs - unit.startMs} ms{l.approxTimes ? ' · approx' : ''}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** The waveform around the unit: window (yellow), play window and cut points (red), envelope (blue). */
function Wave({ buffer, unit, line, style, cacheKey }: { buffer: AudioBuffer; unit: Unit; line: Line; style: LoopStyle; cacheKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = loopWindowFor(line, unit);
  const plan = useMemo(() => planLoop(buffer, w.startMs / 1000, w.endMs / 1000, style, cacheKey), [buffer, w.startMs, w.endMs, style, cacheKey]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = 220;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const t0 = Math.max(0, Math.min(plan.playS[0], plan.unitS[0]) - 0.25);
    const t1 = Math.min(buffer.duration, Math.max(plan.playS[1], plan.unitS[1]) + 0.25);
    const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    // Unit window and padding.
    g.fillStyle = 'rgba(255, 210, 31, 0.45)';
    g.fillRect(x(plan.unitS[0]), 0, x(plan.unitS[1]) - x(plan.unitS[0]), H);
    g.fillStyle = 'rgba(30, 136, 229, 0.12)';
    g.fillRect(x(plan.playS[0]), 0, x(plan.playS[1]) - x(plan.playS[0]), H);
    // Waveform (min/max per pixel, channel 0).
    const d = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const mid = H / 2;
    g.strokeStyle = '#111';
    g.beginPath();
    for (let px = 0; px < W; px++) {
      const a = Math.floor((t0 + ((t1 - t0) * px) / W) * sr);
      const b = Math.floor((t0 + ((t1 - t0) * (px + 1)) / W) * sr);
      let lo = 0;
      let hi = 0;
      for (let i = a; i < b; i++) {
        const v = d[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      g.moveTo(px + 0.5, mid - hi * mid * 0.95);
      g.lineTo(px + 0.5, mid - lo * mid * 0.95);
    }
    g.stroke();
    // Envelope.
    g.strokeStyle = '#1e88e5';
    g.lineWidth = 3;
    g.beginPath();
    for (let px = 0; px < W; px++) {
      const t = t0 + ((t1 - t0) * px) / W;
      const y = H - 6 - envelopeAt(plan, t) * (H - 12);
      if (px === 0) g.moveTo(px, y);
      else g.lineTo(px, y);
    }
    g.stroke();
    // Cut points.
    g.strokeStyle = '#e8303a';
    g.lineWidth = 2;
    for (const t of plan.playS) {
      g.beginPath();
      g.moveTo(x(t), 0);
      g.lineTo(x(t), H);
      g.stroke();
    }
    g.fillStyle = '#111';
    g.font = '12px monospace';
    g.fillText(`${Math.round(t0 * 1000)} ms`, 4, 14);
    g.fillText(`${Math.round(t1 * 1000)} ms`, W - 70, 14);
    g.fillText(`cut ${Math.round(plan.playS[0] * 1000)}–${Math.round(plan.playS[1] * 1000)} · unit ${Math.round(plan.unitS[0] * 1000)}–${Math.round(plan.unitS[1] * 1000)}`, 4, H - 8);
  }, [buffer, plan]);
  return (
    <Card>
      <canvas ref={ref} style={{ width: '100%', height: 220, display: 'block', border: '3px solid var(--ink)' }} data-wave />
      <p style={{ margin: '6px 0 0', fontSize: 13 }}>yellow: the unit window · blue band: what is played · red: cut points · blue line: the envelope</p>
    </Card>
  );
}
