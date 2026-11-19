// /dev/scenes: every scene by episode with filters; /dev/scenes?scene=<id>: everything the bundle
// holds for one scene (player, lines, units, glosses, timings and flags, notes, questions with their
// units and clips, alternates, thumbnail and frames). Plain English (dev tooling).
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { ContentIndex, GlossUnit, Line, Scene } from '../../../../shared/content';
import { loadIndex, loadScene } from '../../api';
import { audio } from '../../audio';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { GlossText } from '../../scene/GlossText';
import { ScenePlayer } from '../../scene/ScenePlayer';
import { loopWindowFor } from '../../scene/timing';
import { Button, Card, Spinner } from '../../ui';
import { DevShell, Tag, field } from './devParts';

type Alternate = { fr: string; en: string; units: GlossUnit[]; audio?: string };
const altsOf = (l: Line) => ((l as Line & { alternates?: Alternate[] }).alternates ?? []);

export default function DevScenesScreen() {
  const id = new URLSearchParams(useSearch()).get('scene');
  return id ? <SceneDetail id={id} /> : <SceneBrowser />;
}

// ---- the browser -------------------------------------------------------------------------------

interface Facts {
  approx: number;
  questions: number;
  alternates: number;
}

function SceneBrowser() {
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [facts, setFacts] = useState<Record<string, Facts>>({});
  const [kind, setKind] = useState('all');
  const [difficulty, setDifficulty] = useState(0);
  const [score, setScore] = useState(0);
  const [approx, setApprox] = useState('any');
  const [text, setText] = useState('');

  useEffect(() => {
    void loadIndex().then(async (i) => {
      setIndex(i);
      // Facts that only the scene files hold, loaded in the background.
      const acc: Record<string, Facts> = {};
      for (let k = 0; k < i.scenes.length; k += 12) {
        const batch = await Promise.all(i.scenes.slice(k, k + 12).map((x) => loadScene(x.id).catch(() => null)));
        for (const sc of batch) if (sc) acc[sc.id] = { approx: sc.lines.filter((l) => l.approxTimes).length, questions: sc.questions.length, alternates: sc.lines.reduce((n, l) => n + altsOf(l).length, 0) };
        setFacts({ ...acc });
      }
    });
  }, []);

  const shown = useMemo(() => {
    if (!index) return [];
    const q = text.trim().toLowerCase();
    return index.scenes.filter((sc) => {
      if (kind !== 'all' && sc.kind !== kind) return false;
      if (difficulty && sc.difficulty !== difficulty) return false;
      if (sc.score < score) return false;
      const f = facts[sc.id];
      if (approx === 'yes' && !(f && f.approx > 0)) return false;
      if (approx === 'no' && !(f && f.approx === 0)) return false;
      if (q && !`${sc.id} ${sc.titleFr} ${sc.titleEn}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [index, kind, difficulty, score, approx, text, facts]);

  if (!index) return <Spinner />;
  const sel = { minHeight: 44, fontSize: 16 } as const;
  return (
    <DevShell title="Scenes" back>
      <Card>
        <div style={{ display: 'grid', gap: 8 }}>
          {field('Search', <input value={text} onChange={(e) => setText(e.target.value)} style={sel} placeholder="id or title" />)}
          {field(
            'Kind',
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={sel} data-filter-kind>
              <option value="all">all</option>
              <option value="dialogue">dialogue</option>
              <option value="monologue">monologue</option>
              <option value="song">song</option>
            </select>,
          )}
          {field(
            'Difficulty',
            <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} style={sel}>
              <option value={0}>any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Score at least',
            <select value={score} onChange={(e) => setScore(Number(e.target.value))} style={sel}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n || 'any'}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Approximate timings',
            <select value={approx} onChange={(e) => setApprox(e.target.value)} style={sel}>
              <option value="any">any</option>
              <option value="yes">has approxTimes lines</option>
              <option value="no">none</option>
            </select>,
          )}
          <span>
            {shown.length} of {index.scenes.length} scenes{Object.keys(facts).length < index.scenes.length ? ` (reading scene files: ${Object.keys(facts).length})` : ''}
          </span>
        </div>
      </Card>
      {index.episodes.map((ep) => {
        const list = shown.filter((sc) => sc.episode === ep.id).sort((a, b) => a.order - b.order);
        if (!list.length) return null;
        return (
          <Card key={ep.id}>
            <h2 style={{ margin: '0 0 8px' }}>
              Episode {ep.number}: {ep.titleFr}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {list.map((sc) => {
                const f = facts[sc.id];
                return (
                  <Link key={sc.id} href={`/dev/scenes?scene=${sc.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, border: '2px solid var(--ink)', background: 'var(--white)', padding: 6 }} data-dev-scene={sc.id}>
                    <img src={sc.thumb} alt="" style={{ width: 96, height: 54, objectFit: 'cover', border: '2px solid var(--ink)', flex: 'none' }} />
                    <span style={{ fontSize: 13 }}>
                      <b>{sc.titleFr}</b>
                      <br />
                      <code>{sc.id}</code>
                      <br />
                      {sc.kind} · difficulty {sc.difficulty} · score {sc.score} · {sc.lineCount} lines
                      {f && f.approx > 0 ? ` · ${f.approx} approx` : ''}
                      {f ? ` · ${f.questions} q` : ''}
                      {f && f.alternates ? ` · ${f.alternates} alt` : ''}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Card>
        );
      })}
    </DevShell>
  );
}

// ---- one scene ---------------------------------------------------------------------------------

const ms = (n: number) => `${(n / 1000).toFixed(2)}s`;

function SceneDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setScene(null);
    loadScene(id).then(setScene, (e: unknown) => setError(String(e)));
  }, [id]);
  if (error) return <Card color="tomato">{error}</Card>;
  if (!scene) return <Spinner />;
  const { lines, notes, questions, frames } = scene;
  const cell = { padding: '3px 6px', borderBottom: '1px solid var(--ink)', fontSize: 13, verticalAlign: 'top' } as const;
  return (
    <DevShell title={`${scene.titleFr} (${scene.id})`} back>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="sm" color="white" onClick={() => navigate('/dev/scenes')}>
            all scenes
          </Button>
          <Button size="sm" color="yellow" onClick={() => navigate(`/dev/practice?scene=${scene.id}`)}>
            compose a practice
          </Button>
          <Tag>{scene.kind}</Tag>
          <Tag>difficulty {scene.difficulty}</Tag>
          <Tag>score {scene.score}</Tag>
          <Tag>{ms(scene.durationMs)}</Tag>
          <Tag>episode {scene.episode} · order {scene.order} · starts {ms(scene.startMs)}</Tag>
          <span style={{ fontSize: 13 }}>{scene.titleEn}</span>
        </div>
      </Card>
      <Card>
        <ScenePlayer scene={scene} autoPlay={false} showEnglish />
      </Card>

      {lines.map((l) => (
        <Card key={l.id}>
          <div data-dev-line={l.id}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <b>{l.id}</b>
              {l.speaker && <Tag>{l.speaker}</Tag>}
              <Tag>
                {ms(l.startMs)}–{ms(l.endMs)}
              </Tag>
              {l.approxTimes && <Tag color="var(--tomato)">approxTimes</Tag>}
              <Button size="sm" color="white" icon="loop" onClick={() => audio.playRange(scene.audio.src, l.startMs, l.endMs, { loop: true, tag: `dev:${l.id}` })}>
                loop line
              </Button>
            </div>
            <DialogueStrip scene={scene} lineIds={[l.id]} showEnglish compact />
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  {['unit', 'fr', 'en (gloss)', 'kind', 'key', 'window', 'words', 'note', ''].map((h) => (
                    <th key={h} style={{ ...cell, borderBottom: '2px solid var(--ink)', textAlign: 'left' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {l.units.map((u) => {
                  const w = loopWindowFor(l, u);
                  return (
                    <tr key={u.id}>
                      <td style={cell}>
                        <code>{u.id.split(':').pop()}</code>
                      </td>
                      <td style={cell}>{u.fr}</td>
                      <td style={cell}>{u.en}</td>
                      <td style={cell}>{u.kind}</td>
                      <td style={cell}>{u.key ? 'key' : ''}</td>
                      <td style={cell}>
                        {u.startMs}–{u.endMs}
                        {l.approxTimes ? ' (loops the line)' : ''}
                      </td>
                      <td style={cell}>{u.words.map((wd) => `${wd.fr} ${wd.startMs}–${wd.endMs}`).join(' · ')}</td>
                      <td style={cell}>{u.note ?? ''}</td>
                      <td style={cell}>
                        <Button size="sm" color="white" onClick={() => audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: true, tag: `dev:${u.id}` })}>
                          loop
                        </Button>{' '}
                        {u.drill && (
                          <Button size="sm" color="white" onClick={() => audio.play(u.drill!)}>
                            drill
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {altsOf(l).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <b>Alternates</b>
                {altsOf(l).map((a, k) => (
                  <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }} data-dev-alternate>
                    <GlossText fr={a.fr} units={a.units} size="sm" />
                    <span style={{ fontSize: 13 }}>{a.en}</span>
                    {a.audio && (
                      <Button size="sm" color="white" icon="play" onClick={() => audio.play(a.audio!)}>
                        clip
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      ))}

      <Card>
        <h2 style={{ margin: '0 0 8px' }}>Notes ({notes.length})</h2>
        {notes.map((n, i) => (
          <p key={i} style={{ fontSize: 14 }}>
            <Tag>{n.kind}</Tag> {n.phrase && <b>{n.phrase}</b>} {n.lineId && <code>{n.lineId}</code>} {n.unitIds?.join(', ')} — {n.text}
          </p>
        ))}
      </Card>

      <Card>
        <h2 style={{ margin: '0 0 8px' }}>Questions ({questions.length})</h2>
        {questions.map((q) => (
          <div key={q.id} style={{ borderTop: '2px solid var(--ink)', padding: '8px 0' }} data-dev-question={q.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code>{q.id}</code>
              {q.lineId && <Tag>{q.lineId}</Tag>}
              <Tag>voice {q.voice}</Tag>
              {/* The static clips the kids' question puzzle plays (absent when no clip was generated). */}
              <Button size="sm" color="white" icon="play" data-question-clip disabled={!q.audio} onClick={() => q.audio && audio.play(q.audio, { voice: q.voice, onError: (e) => console.warn(`[dev] question clip: ${e.status}`) })}>
                {q.audio ? 'question clip' : 'no question clip'}
              </Button>
            </div>
            <GlossText fr={q.fr} units={q.units} size="md" />
            <div style={{ fontSize: 13 }}>{q.en}</div>
            {q.answers.map((a, k) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                <Tag color={a.correct ? 'var(--lime)' : 'var(--white)'}>{a.correct ? 'right' : 'funny'}</Tag>
                <GlossText fr={a.fr} units={a.units} size="sm" />
                <span style={{ fontSize: 13 }}>{a.en}</span>
                <Button size="sm" color="white" icon="play" data-answer-clip disabled={!a.audio} onClick={() => a.audio && audio.play(a.audio, { voice: q.voice, onError: (e) => console.warn(`[dev] answer clip: ${e.status}`) })}>
                  {a.audio ? 'clip' : 'no clip'}
                </Button>
              </div>
            ))}
          </div>
        ))}
      </Card>

      <Card>
        <h2 style={{ margin: '0 0 8px' }}>Thumbnail and frames ({frames.length})</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          <figure style={{ margin: 0 }}>
            <img src={scene.thumb} alt="" style={{ width: '100%', border: '3px solid var(--tomato)' }} />
            <figcaption style={{ fontSize: 12 }}>thumbnail</figcaption>
          </figure>
          {frames.map((f) => (
            <figure key={f.src} style={{ margin: 0 }}>
              <img src={f.src} alt="" loading="lazy" style={{ width: '100%', border: '2px solid var(--ink)' }} />
              <figcaption style={{ fontSize: 12 }}>{ms(f.t)}</figcaption>
            </figure>
          ))}
        </div>
      </Card>
    </DevShell>
  );
}
