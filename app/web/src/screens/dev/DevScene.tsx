// /dev/scene?scene=<id>: the scene components and the effects kit on any scene.
// The ScenePlayer, the DialogueStrip in its variants (masked, blank, compact, disabled), the
// Slideshow at a fixed time, every effect and sound, and the audio engine's live state.
// Dev tooling for agents: plain English labels, not translated.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { ContentIndex, Scene } from '../../../../shared/content';
import { loadIndex, loadScene } from '../../api';
import { audio, useAudioClock, useAudioState, type SfxName } from '../../audio';
import { fx, type BurstKind } from '../../fx';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { GlossText } from '../../scene/GlossText';
import { ScenePlayer } from '../../scene/ScenePlayer';
import { Slideshow } from '../../scene/Slideshow';
import { Button, Card, Spinner } from '../../ui';
import s from './DevUi.module.css';

const SFX: SfxName[] = ['tap', 'pop', 'whoosh', 'sparkle', 'coin', 'chest', 'level', 'rankUp', 'right', 'wrong', 'win'];
const BURSTS: BurstKind[] = ['star', 'coin', 'spark', 'confetti', 'heart', 'dot'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.section}>
      <h2 className={s.h}>{title}</h2>
      <Card>{children}</Card>
    </section>
  );
}

function EngineState() {
  const st = useAudioState();
  const ms = useAudioClock((m) => Math.round(m / 10) * 10);
  return (
    <pre data-audio-state style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
      {JSON.stringify({ ...st, live: ms, unlocked: audio.isUnlocked(), loopsHeard: audio.loopsHeard() }, null, 1)}
    </pre>
  );
}

export default function DevSceneScreen() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const id = new URLSearchParams(search).get('scene') ?? 's01e03-0134-0140';
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [hints, setHints] = useState(0);
  const fxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadIndex().then(setIndex);
  }, []);
  useEffect(() => {
    setScene(null);
    void loadScene(id).then(setScene);
  }, [id]);

  if (!scene) return <Spinner />;
  const ids = scene.lines.map((l) => l.id);
  const keyUnits = scene.lines.flatMap((l) => l.units.filter((u) => u.key).map((u) => u.id)).filter((_, i) => i % 2 === 0);
  const at = () => fxRef.current ?? document.body;

  return (
    <div className={s.page}>
      <Card>
        <select
          style={{ minHeight: 44, fontSize: 16, width: '100%', border: '3px solid var(--ink)' }}
          value={id}
          onChange={(e) => navigate(`/dev/scene?scene=${encodeURIComponent(e.target.value)}`)}
          data-scene-select
        >
          {(index?.scenes ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} · {x.titleFr} · {x.lineCount} lines
            </option>
          ))}
        </select>
      </Card>

      <Section title="ScenePlayer">
        <ScenePlayer scene={scene} autoPlay={false} showEnglish />
      </Section>

      <Section title={`DialogueStrip, hints counted: ${hints}`}>
        <DialogueStrip scene={scene} lineIds={ids} onHint={() => setHints((n) => n + 1)} />
      </Section>

      <Section title="masked (initial) · masked (blank, one filled) · compact · disabled">
        <div className={s.stack}>
          <DialogueStrip scene={scene} lineIds={ids.slice(0, 2)} masked={keyUnits} maskStyle="initial" />
          <DialogueStrip scene={scene} lineIds={ids.slice(0, 2)} masked={keyUnits} maskStyle="blank" maskFill={keyUnits[0] ? { [keyUnits[0]]: '???' } : undefined} />
          <DialogueStrip scene={scene} lineIds={ids.slice(0, 2)} compact showEnglish />
          <DialogueStrip scene={scene} lineIds={ids.slice(0, 1)} disabled />
        </div>
      </Section>

      <Section title="GlossText (a question and its answers) · voices">
        {(() => {
          const q = scene.questions[0];
          if (!q) return <p>No question in this scene.</p>;
          // A demo split of the question into words, when the export gave one unit only.
          const units = q.units.length > 1 ? q.units : [...q.fr.matchAll(/[\p{L}'’-]+/gu)].map((m) => ({ fr: m[0], en: `(${m[0]})`, cs: m.index!, ce: m.index! + m[0].length }));
          return (
            <div className={s.stack}>
              <GlossText fr={q.fr} units={units} size="lg" />
              {q.answers.map((a, i) => (
                <Card key={i} color={a.correct ? 'lime' : 'white'} padding="tight">
                  <GlossText fr={a.fr} units={a.units} size="sm" tone="paper" />
                </Card>
              ))}
              <div className={s.wrap}>
                {(['squeaky', 'deep', 'wobble', 'echo'] as const).map((v) => (
                  <Button key={v} size="sm" color="white" data-voice={v} onClick={() => audio.play(scene.audio.src, { voice: v, tag: `voice:${v}` })}>
                    {v}
                  </Button>
                ))}
                {/* The question's static clip, as the kids' question puzzle plays it. */}
                <Button size="sm" color="tomato" data-question-clip disabled={!q.audio} onClick={() => q.audio && audio.play(q.audio, { voice: q.voice, onError: (e) => console.warn(`[dev] question clip: ${e.status}`) })}>
                  {q.audio ? `clip ${q.voice}` : 'no clip'}
                </Button>
              </div>
            </div>
          );
        })()}
      </Section>

      <Section title="Slideshow at 0 ms / at the middle">
        <div className={s.grid}>
          <Slideshow frames={scene.frames} timeMs={0} />
          <Slideshow frames={scene.frames} timeMs={scene.audio.durationMs / 2} />
        </div>
      </Section>

      <Section title="Effects">
        <div ref={fxRef} className={s.center} style={{ padding: 12, border: '3px dashed var(--ink)' }}>
          target
        </div>
        <div className={s.wrap} style={{ marginTop: 12 }}>
          <Button color="yellow" onClick={() => fx.impact()} data-fx="impact">
            impact
          </Button>
          <Button color="yellow" onClick={() => fx.impact(undefined, at())}>
            impact sm
          </Button>
          <Button color="lime" onClick={() => fx.right(at())}>
            right
          </Button>
          <Button color="tomato" onClick={() => fx.wrong(at())}>
            wrong
          </Button>
          <Button color="cyan" onClick={() => fx.combo(3)}>
            combo
          </Button>
          <Button color="purple" onClick={() => fx.celebrate()} data-fx="celebrate">
            celebrate
          </Button>
          <Button color="blue" onClick={() => fx.confetti()}>
            confetti
          </Button>
          <Button color="white" onClick={() => fx.shake()}>
            shake
          </Button>
          <Button color="white" onClick={() => fx.floatText(at(), '+10 XP')}>
            floatText
          </Button>
          {BURSTS.map((k) => (
            <Button key={k} size="sm" color="white" onClick={() => fx.burst(at(), k)}>
              burst {k}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Sounds (effects bus)">
        <div className={s.wrap}>
          {SFX.map((n) => (
            <Button key={n} size="sm" color="white" onClick={() => fx.sfx(n)} data-sfx={n}>
              {n}
            </Button>
          ))}
          <Button size="sm" color="tomato" onClick={() => audio.stop()}>
            stop French
          </Button>
        </div>
      </Section>

      <Section title="Audio engine">
        <EngineState />
      </Section>
    </div>
  );
}
