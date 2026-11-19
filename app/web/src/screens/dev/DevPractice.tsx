// /dev/practice: play puzzle types directly in the real shell (the e2e specs use it), or start a real practice
// through the API. Composing and reviewing practices is /dev/practices (DevPractices.tsx); a /dev/practice URL
// without a puzzle type or a plan goes there.
//   /dev/practice?scene=…&type=listen-pick&level=1&seed=1       one puzzle type, played at once (as before)
//   /dev/practice?scene=a,b&level=&seed=&speak=0|1               the table
//   …&run=1[&puzzle=n]                                          play that composition (from puzzle n)
//   …&replay=1                                                  the header shows it as a replay
//   /dev/practice?plan=practice | plan=scene&scene=…            a real practice through the API
// Completion is faked locally: nothing is posted, no level changes. Plain English (dev tooling).
import { useEffect, useMemo, useState } from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import type { ContentIndex } from '../../../../shared/content';
import { api, loadIndex } from '../../api';
import { PracticeRunner } from '../../practice/PracticeRunner';
import { Card, Spinner } from '../../ui';
import { composeDev, devQuery, fakeComplete, parseDev, type DevComposed } from './devCompose';

export default function DevPracticeScreen() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const q = new URLSearchParams(search);
  const p = useMemo(() => parseDev(search), [search]);
  const plan = q.get('plan');
  const run = q.get('run') === '1' || p.puzzleTypes.length > 0;
  const only = q.get('only') === '1'; // play just puzzle `puzzle` of the composition
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [composed, setComposed] = useState<DevComposed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speak, setSpeak] = useState(p.speak);

  useEffect(() => {
    void loadIndex().then(setIndex);
  }, []);

  // A real practice through the API (the fixture client under VITE_FIXTURES=1).
  useEffect(() => {
    if (plan !== 'practice' && plan !== 'scene') return;
    if (!p.scenes[0]) {
      setError('scene= is needed');
      return;
    }
    api
      .startPractice({ kind: 'scene', sceneId: p.scenes[0] })
      .then((r) => {
        navigate(`/practice/${r.plan.id}`, { state: { plan: r.plan, fresh: true } });
      })
      .catch((e: unknown) => setError(String(e)));
  }, [plan, p.scenes, navigate]);

  useEffect(() => {
    setComposed(null);
    setError(null);
    if (plan || !p.scenes.length || !index) return;
    let live = true;
    composeDev(p, index).then(
      (c) => live && setComposed(c),
      (e: unknown) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [p, plan, index]);

  if (error) return <Card color="tomato">{error}</Card>;
  if (plan) return <Spinner />;

  if (run && composed) {
    const back = `/dev/practice?${devQuery({ ...p, puzzleTypes: p.puzzleTypes, puzzle: 0 })}`;
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} data-dev-practice>
        <PracticeRunner
          key={search}
          practice={only ? { ...composed.practice, puzzles: composed.practice.puzzles.slice(p.puzzle, p.puzzle + 1) } : composed.practice}
          scenes={composed.scenes}
          speak={speak}
          onSpeakChange={setSpeak}
          replay={q.get('replay') === '1'}
          startAt={p.puzzle && !only ? { puzzleIndex: p.puzzle, outcomes: [], ms: 0 } : null}
          complete={(outcomes) => new Promise((r) => setTimeout(() => r(fakeComplete(composed.practice, outcomes)), 400))}
          onExit={() => navigate(p.puzzleTypes.length ? '/dev/practice' : back)}
          onFinish={() => navigate(p.puzzleTypes.length ? '/dev/practice' : back)}
          dev
        />
      </div>
    );
  }
  if (run && p.scenes.length) return <Spinner />;
  // Everything else is the practice viewer now.
  return <Redirect to={`/dev/practices${search ? `?${search}` : ''}`} />
}
