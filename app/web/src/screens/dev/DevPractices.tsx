// /dev/panono: the long practice prototype (composePractice) on the Panono scene, for the user's
// review. The plan table (which line each puzzle targets), coverage per line, and the practice played
// through the real practice shell, with "continue where you left off". Everything stays
// local: no practice result or progress is posted, no level changes. Plain English (dev tooling).
import { useEffect, useMemo, useState } from 'react';
import type { ContentIndex } from '../../../../shared/content';
import type { PuzzleOutcome } from '../../../../shared/practice/types';
import { loadIndex } from '../../api';
import { PracticeRunner } from '../../practice/PracticeRunner';
import { Button, Card, Spinner } from '../../ui';
import { composeDev, fakeComplete, PANONO, rowsOf, type DevComposed } from './devCompose';
import { CoverageBars, DevPlanTable, DevShell, Tag, field } from './devParts';

interface Saved {
  done: number;
  outcomes: PuzzleOutcome[];
}
const key = (sceneId: string, level: number, seed: number, speak: boolean) => `frx.dev.practice.${sceneId}.${level}.${seed}.${speak ? 1 : 0}`;
function loadSaved(k: string): Saved | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function storeSaved(k: string, v: Saved | null): void {
  try {
    if (v) localStorage.setItem(k, JSON.stringify(v));
    else localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
}

export default function DevPracticesScreen() {
  const q = new URLSearchParams(location.search);
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [sceneId, setSceneId] = useState(q.get('scene') ?? PANONO);
  const [level, setLevel] = useState(Number(q.get('level') ?? 1) || 1);
  const [seed, setSeed] = useState(Number(q.get('seed') ?? 1) || 1);
  const [speak, setSpeak] = useState(q.get('speak') !== '0');
  const [composed, setComposed] = useState<DevComposed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null); // the puzzle to start at
  const [saved, setSaved] = useState<Saved | null>(null);
  const k = key(sceneId, level, seed, speak);

  useEffect(() => {
    void loadIndex().then(setIndex);
  }, []);
  useEffect(() => {
    if (!index) return;
    setComposed(null);
    setError(null);
    setSaved(loadSaved(k));
    composeDev({ scenes: [sceneId], puzzleTypes: [], level, seed, speak, puzzle: 0 }, index).then(setComposed, (e: unknown) => setError(String(e)));
    history.replaceState(history.state, '', `${location.pathname}?scene=${sceneId}&level=${level}&seed=${seed}${speak ? '' : '&speak=0'}`);
  }, [index, sceneId, level, seed, speak, k]);

  const rows = useMemo(() => (composed ? rowsOf(composed) : []), [composed]);
  const scene = composed?.scenes.get(sceneId);

  if (error) return <Card color="tomato">{error}</Card>;
  if (!composed || !scene) return <Spinner />;

  if (playing !== null) {
    const startOutcomes = saved && playing === saved.done ? saved.outcomes : [];
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} data-dev-panono-run>
        <PracticeRunner
          key={`${k}:${playing}`}
          practice={composed.practice}
          scenes={composed.scenes}
          speak={speak}
          onSpeakChange={setSpeak}
          startAt={playing ? { puzzleIndex: playing, outcomes: startOutcomes, ms: 0 } : null}
          onPuzzleDone={(p) => {
            const v = { done: p.done, outcomes: p.outcomes };
            storeSaved(k, v);
            setSaved(v);
          }}
          complete={(outcomes) => {
            storeSaved(k, null);
            setSaved(null);
            return new Promise((r) => setTimeout(() => r(fakeComplete(composed.practice, outcomes)), 300));
          }}
          onExit={() => setPlaying(null)}
          onFinish={() => setPlaying(null)}
          dev
        />
      </div>
    );
  }

  const plan = composed.report!;
  const sel = { minHeight: 44, fontSize: 16 } as const;
  return (
    <DevShell title="Practices" back>
      <Card>
        <p style={{ margin: '0 0 8px' }}>
          <code>composePractice</code> on <code>{sceneId}</code>, {scene.titleFr}. What the app plays: a practice on one scene at one level (the level it is for; a replay is the practice at the scene's level). Results and progress stay in this browser.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {field(
            'Scene',
            <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} style={sel} data-practice-scene>
              {index?.scenes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id} · {x.titleFr}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Level (earned when passed)',
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))} style={sel} data-panono-level>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Seed',
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ ...sel, width: 120 }} />
              <Button size="sm" color="white" onClick={() => setSeed(1 + Math.floor(Math.random() * 99999))} data-panono-reroll>
                re-roll
              </Button>
            </span>,
          )}
          {field('Speaking', <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} style={{ width: 28, height: 28 }} data-panono-speak />)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {saved && saved.done > 0 && saved.done < composed.practice.puzzles.length ? (
            <>
              <Button color="yellow" size="lg" icon="play" onClick={() => setPlaying(saved.done)} data-panono-continue>
                Continue ({saved.done} / {composed.practice.puzzles.length})
              </Button>
              <Button color="white" onClick={() => { storeSaved(k, null); setSaved(null); setPlaying(0); }} data-panono-restart>
                start over
              </Button>
            </>
          ) : (
            <Button color="lime" size="lg" icon="play" onClick={() => setPlaying(0)} data-panono-play>
              Play the practice
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <p style={{ margin: '0 0 8px', fontWeight: 800 }}>
          {plan.length} puzzles (planned {plan.plannedLength}, composer v{plan.composerVersion})
          {composed.problems.length ? ` · problems: ${composed.problems.join('; ')}` : ''}
        </p>
        <div>
          {Object.entries(plan.scopes).map(([sc, n]) => (
            <Tag key={sc}>
              {sc}: {n}
            </Tag>
          ))}
          {Object.entries(plan.typeCounts).map(([ty, n]) => (
            <Tag key={ty} color="var(--white)">
              {ty} ×{n}
            </Tag>
          ))}
          {plan.ignoresTarget.length > 0 && <Tag color="var(--tomato)">ignore the target line: {plan.ignoresTarget.join(', ')}</Tag>}
        </div>
      </Card>

      <Card>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Coverage per line</h2>
        <CoverageBars lines={plan.coverage} scene={scene} />
      </Card>

      <Card>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>The plan</h2>
        <DevPlanTable rows={rows} scenes={composed.scenes} current={saved?.done} onPlayFrom={(r) => setPlaying(r.index)} />
      </Card>
    </DevShell>
  );
}
