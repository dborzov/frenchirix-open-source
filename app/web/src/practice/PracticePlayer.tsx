// Runs a practice from its plan (a practice on one scene at one level, or a replay): loads the scene,
// composes it with composePractice from the plan's seed (the same puzzles the checks validated), waits
// behind the media gate for the scene's audio and first frames (media/MediaGate.tsx: a progress bar, the
// slow line, the error panel with « Réessayer »), and hands it to PracticeRunner, which plays it from puzzle `done`
// (resumeIndex) to the end with no breaks. Saves progress after every puzzle, once per try, and the
// runner waits for it (every call carries the total); the last puzzle completes the practice (the
// level, the quest). Nothing is queued or retried behind the kid's back.
import { useEffect, useMemo, useState } from 'react';
import type { PracticeCompleteResponse } from '../../../shared/api';
import type { ContentIndex, Scene } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { composePractice, resumeIndex, type ComposedPractice } from '../../../shared/practice/practice';
import { COMPOSER_VERSION } from '../../../shared/practice/version';
import type { PracticePlan } from '../../../shared/practice/types';
import { api, loadIndex, loadScene } from '../api';
import { audio } from '../audio';
import { flushEvents } from '../audio/events';
import { log } from '../log';
import { MediaGate } from '../media/MediaGate';
import { fetchAhead, firstMoment } from '../media/loadMedia';
import { usePlayer } from '../state/player';
import { actionFailed, recover } from '../state/recover';
import { Button, ErrorPanel } from '../ui';
import { practiceClips } from './clips';
import s from './Practice.module.css';
import { PracticeRunner } from './PracticeRunner';
import { forgetPractice, loadProgress, saveProgress, type PracticeProgress } from './storage';

export interface PracticePlayerProps {
  plan: PracticePlan;
  onExit: (done?: number) => void;
  /** After the results (the response carries the quest's chest, if any). Defaults to onExit. */
  onFinish?: (res: PracticeCompleteResponse | null) => void;
}

interface Loaded {
  practice: ComposedPractice;
  scenes: Map<string, Scene>;
  /** Composed by the same composer from the same content as when the plan was made (resumeIndex). */
  same: boolean;
}

/** The scene of a plan: its sceneId, else its one entry. */
function sceneIdOf(plan: PracticePlan): string {
  return plan.sceneId ?? plan.entries[0]!.sceneId;
}

/** Load the plan's scene and compose its practice. Also used by the dev pages. */
export async function preparePractice(plan: PracticePlan, speak: boolean): Promise<Loaded> {
  const sceneId = sceneIdOf(plan);
  const [index, scene] = await Promise.all([loadIndex(), loadScene(sceneId)]);
  const others = await Promise.all((index as ContentIndex).scenes.filter((x) => x.id !== sceneId && x.episode === scene.episode).slice(0, 2).map((x) => loadScene(x.id).catch(() => null)));
  // The audio first (the practice screen's gate waits for it and the first frames; the dev pages do not).
  void audio.preload(scene.audio.src);
  const input = {
    id: plan.id,
    seed: plan.seed,
    scene,
    speak,
    bank: index.bank,
    allowedQuestionIds: plan.allowedQuestionIds,
    others: others.filter((x): x is Scene => !!x),
  };
  const level = plan.level ?? plan.entries[0]?.level ?? 1;
  const practice = composePractice({ ...input, level });
  const same = plan.composerVersion === COMPOSER_VERSION && (!plan.contentVersion || plan.contentVersion === (index as ContentIndex).version);
  return { practice, scenes: new Map([[scene.id, scene]]), same };
}

export function PracticePlayer({ plan, onExit, onFinish }: PracticePlayerProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tries, setTries] = useState(0);
  const profileSpeak = usePlayer((st) => st.state?.profile.speak ?? true);
  const [speak, setSpeak] = useState(plan.speak && profileSpeak);

  useEffect(() => {
    let live = true;
    setError(null);
    // Compose with the plan's speak flag so the puzzles match what the server's checks composed;
    // mic puzzles are replaced by their tapping equivalent (puzzle.alt) when the kid turns speaking off.
    preparePractice(plan, plan.speak)
      .then((l) => {
        if (!live) return;
        log('practice-open', { practiceId: plan.id, sceneId: sceneIdOf(plan), level: plan.level ?? null, replay: !!plan.replay, puzzles: l.practice.puzzles.length, startAt: plan.done ?? 0, speak: plan.speak });
        setLoaded(l);
      })
      .catch((e: unknown) => {
        if (!live) return;
        recover(e);
        setError(e);
      });
    return () => {
      live = false;
      audio.stop();
      void flushEvents();
    };
  }, [plan, tries]);

  const changeSpeak = (v: boolean) => {
    setSpeak(v);
    // The switch takes effect at once in this practice; saving it in the profile may fail quietly
    // (the next practice asks again), but the kid is told.
    api
      .patchMe({ speak: v })
      .then((r) => usePlayer.getState().apply(r.patch))
      .catch(actionFailed);
  };

  if (error) {
    return (
      <div className={s.practice} style={{ justifyContent: 'center', padding: '0 16px' }}>
        <ErrorPanel
          error={error}
          onRetry={() => {
            setError(null);
            setTries((n) => n + 1);
          }}
          secondary={
            <Button color="white" icon="home" onClick={() => onExit()} data-error-home>
              {t('nav.home')}
            </Button>
          }
        />
      </div>
    );
  }
  const scene = loaded ? loaded.scenes.values().next().value : undefined;
  const start = loaded ? startAt(plan, loaded.practice.puzzles.length, loaded.same) : null;
  return (
    <MediaGate media={scene ? firstMoment(scene) : null} onHome={() => onExit()} className={s.practice}>
      {loaded && scene && (
        <>
          <FetchAhead puzzles={loaded.practice.puzzles} scene={scene} from={start?.puzzleIndex ?? 0} />
          {runner(loaded, start)}
        </>
      )}
    </MediaGate>
  );

  function runner(loaded: Loaded, start: PracticeProgress | null) {
    return (
      <PracticeRunner
        practice={loaded.practice}
        scenes={loaded.scenes}
        speak={speak}
        onSpeakChange={changeSpeak}
        level={plan.level ?? loaded.practice.level}
        replay={!!plan.replay}
        startAt={start}
        onProgress={(p) => saveProgress(plan.id, p)}
        onPuzzleDone={async (p) => {
          const r = await api.practiceProgress(plan.id, { done: p.done, total: p.total, outcomes: p.outcomes });
          usePlayer.getState().apply(r.patch);
        }}
        complete={async (outcomes, ms) => {
          const res = await api.completePractice(plan.id, { outcomes, ms });
          usePlayer.getState().apply(res.patch);
          forgetPractice(plan.id);
          return res;
        }}
        onExit={onExit}
        onFinish={onFinish ?? (() => onExit())}
      />
    );
  }
}

/**
 * Once the first puzzle is on screen, the rest of this practice's clips are fetched in the background
 * (in puzzle order, a few at a time), so later puzzles do not wait. Nothing for other scenes; a failure
 * stays quiet until the puzzle plays that clip.
 */
function FetchAhead({ puzzles, scene, from }: { puzzles: ComposedPractice['puzzles']; scene: Scene; from: number }) {
  const clips = useMemo(() => practiceClips(puzzles, scene, from), [puzzles, scene, from]);
  useEffect(() => fetchAhead(clips), [clips]);
  return null;
}

/**
 * Where to start: the furthest of this tab's own progress (sessionStorage, the fast path) and what the
 * server says is done (plan.done, a practice continued from another visit or device). The state inside a
 * puzzle is never kept: a continued practice starts at the first unfinished puzzle.
 */
function startAt(plan: PracticePlan, total: number, same: boolean): PracticeProgress | null {
  const local = loadProgress(plan.id);
  const server = plan.done ?? 0;
  if (local && local.puzzleIndex >= server) return local;
  if (server > 0) return { puzzleIndex: resumeIndex(server, total, same), outcomes: plan.outcomes ?? [], ms: 0 };
  return local;
}
