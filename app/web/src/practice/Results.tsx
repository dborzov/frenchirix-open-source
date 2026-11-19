// The end of a practice as a comic splash page: the level it was for (or « Rejouer »), a big burst,
// stars from mistakes, XP counting up, the scene's level going up with a proper moment (or "silver in
// 2 days" after a replay), the streak flame (and a full streak when today's quests are all done), the
// quest it did and its chest, achievements unlocked, then onward (to the chest when there is one). It
// shows once the completion is saved (the shell waits for it); `alreadySaved` when the server said the
// practice was finished already (on another device, or the answer to an earlier try got lost): the
// stars, and no numbers.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PracticeCompleteResponse } from '../../../shared/api';
import { ACHIEVEMENTS_BY_ID } from '../../../shared/catalog/achievements';
import type { Scene } from '../../../shared/content';
import { getLanguage, t, type TKey } from '../../../shared/i18n';
import type { PuzzleOutcome } from '../../../shared/practice/types';
import { daysBetween, practiceStars, type Level } from '../../../shared/rules';
import { audio } from '../audio';
import { fx } from '../fx';
import { usePlayer } from '../state/player';
import { Badge, Button, Icon, cx } from '../ui';
import { LevelTag } from './LevelTag';
import s from './Practice.module.css';

export interface ResultsProps {
  scenes: ReadonlyMap<string, Scene>;
  outcomes: PuzzleOutcome[];
  result: PracticeCompleteResponse | null;
  /** The level the practice was for, and whether it was a replay (the cover's tag). */
  level: number;
  replay: boolean;
  /** The practice had been saved already: no numbers to show. */
  alreadySaved?: boolean;
  onContinue: () => void;
  dev?: boolean;
}

function useCountUp(target: number, run: boolean, ms = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (fx.reducedMotion()) {
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    let lastTick = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const val = Math.round(target * (1 - Math.pow(1 - k, 3)));
      setV(val);
      if (val - lastTick >= Math.max(1, Math.ceil(target / 8))) {
        lastTick = val;
        audio.sfx('tap');
      }
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

export function Results({ scenes, outcomes, result, level, replay, alreadySaved, onContinue }: ResultsProps) {
  const mistakes = outcomes.reduce((n, o) => n + o.mistakes, 0);
  const hints = outcomes.reduce((n, o) => n + o.hints, 0);
  const stars = result?.stars ?? practiceStars(outcomes.length, mistakes, hints);
  const [beat, setBeat] = useState(0); // 0 title, 1..3 stars, 4 xp, 5 levels
  const today = usePlayer((st) => st.state?.today);
  const progress = usePlayer((st) => st.state?.progress);
  const lang = getLanguage();
  const titleKey: TKey = stars === 3 ? 'practice.result.perfect' : stars === 2 ? 'practice.result.great' : 'practice.result.done';

  useEffect(() => {
    fx.celebrate();
    const timers = [1, 2, 3, 4, 5].map((b) => setTimeout(() => setBeat(b), 500 + b * 380));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const starRefs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (beat >= 1 && beat <= 3) {
      const el = starRefs.current[beat - 1];
      if (el && beat <= stars) {
        fx.burst(el, { kind: 'star', count: 10, colors: ['#FFD21F', '#FFFFFF'] });
        audio.sfx('coin');
      }
    }
  }, [beat, stars]);

  // Every XP of this practice: its puzzles' XP, credited by the progress saves as they finished
  // (`creditedXp`), and what the completion credited (the last puzzles, the level, a perfect practice).
  const practiceXp = (result?.rewards.xp ?? 0) + (result?.creditedXp ?? 0);
  const xp = useCountUp(practiceXp, beat >= 4 && !!result);
  const coins = useCountUp(result?.rewards.sesterces ?? 0, beat >= 4 && !!result);

  const levelRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (beat === 5 && result?.levels.length) {
      audio.sfx('level');
      levelRefs.current.forEach((el, i) => {
        if (el) setTimeout(() => fx.impact(t('practice.fx.bing'), el, { size: 'sm' }), i * 300);
      });
    }
    if (beat === 5 && result?.rankUp) setTimeout(() => audio.sfx('rankUp'), 700);
  }, [beat, result]);

  const sceneOf = (id: string) => scenes.get(id);

  return (
    <div className={s.results} data-results>
      <div className={s.cover}>
        <div className={s.coverTop}>
          <LevelTag level={level} replay={replay} className={s.coverTag} />
          {result && <span className={s.price}>{t('common.xp', { n: practiceXp })}</span>}
        </div>
        <h1 className={s.coverTitle}>{t(titleKey)}</h1>
        <div className={s.stars} aria-label={t('practice.result.stars', { n: stars })}>
          {[0, 1, 2].map((i) => (
            <span key={i} ref={(el) => void (starRefs.current[i] = el)} className={cx(s.star, beat > i && s.starIn, i < stars ? s.starOn : s.starOff)} style={{ '--i': i } as CSSProperties}>
              <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden>
                <polygon points="20,2 25,14 38,15 28,24 31,37 20,30 9,37 12,24 2,15 15,14" />
              </svg>
            </span>
          ))}
        </div>
      </div>

      {alreadySaved && (
        <div className={cx(s.panel, s.panelIn, s.saved)} style={{ '--tilt': '-1deg' } as CSSProperties} data-already-saved>
          <span className={s.panelLabel}>{t('practice.alreadySaved.title')}</span>
          <span>{t('practice.alreadySaved.text')}</span>
        </div>
      )}

      {result && (
        <div className={s.panels}>
          <div className={cx(s.panel, s.panelXp, beat >= 4 && s.panelIn)} style={{ '--tilt': '-2deg' } as CSSProperties}>
            <span className={s.panelLabel}>{t('practice.result.won')}</span>
            <span className={s.bigNum} data-xp>
              <Icon name="xp" size={36} /> +{xp}
            </span>
            {coins > 0 && (
              <span className={s.midNum}>
                <Icon name="coin" size={28} /> +{coins}
              </span>
            )}
            {result.rankUp && <span className={s.stamp}>{t('practice.result.rankUp', { n: result.rankUp })}</span>}
          </div>

          <div className={cx(s.panel, s.panelStreak, beat >= 4 && s.panelIn)} style={{ '--tilt': '2deg' } as CSSProperties}>
            <span className={s.panelLabel}>{t('common.streak')}</span>
            <span className={s.bigNum}>
              <Icon name="flame" size={36} /> {result.streak.count}
            </span>
            {result.streak.extended && <span className={s.stamp}>{t('practice.result.streakUp')}</span>}
            {result.streak.full && (
              <span className={cx(s.stamp, s.stampFull)} data-full-streak>
                {t('practice.result.fullStreak')}
              </span>
            )}
            {result.streak.freezesUsed > 0 && <span className={s.small}>{t('practice.result.freezeUsed', { n: result.streak.freezesUsed })}</span>}
          </div>

          {result.quest && (
            <div className={cx(s.panel, s.panelQuest, beat >= 4 && s.panelIn)} style={{ '--tilt': '1deg' } as CSSProperties} data-quest-done={result.quest.index}>
              <span className={s.panelLabel}>{t('practice.result.quest')}</span>
              <span className={s.questRow}>
                <Icon name="chest" size={40} />
                {t('practice.result.questChest')}
              </span>
            </div>
          )}

          {(result.levels.length > 0 || result.replayed.length > 0) && (
            <div className={cx(s.panel, s.panelLevels, beat >= 5 && s.panelIn)} style={{ '--tilt': '-1deg' } as CSSProperties}>
              <span className={s.panelLabel}>{t('practice.result.levels')}</span>
              {result.levels.map((m, i) => (
                <div key={m.sceneId} ref={(el) => void (levelRefs.current[i] = el)} className={s.levelRow} data-level-up={m.sceneId}>
                  <img src={sceneOf(m.sceneId)?.thumb} alt="" className={s.levelThumb} />
                  <span className={s.levelScene}>{sceneOf(m.sceneId)?.titleFr ?? m.sceneId}</span>
                  <span className={s.levelSwap}>
                    {m.from > 0 && <Badge level={m.from} size={34} />}
                    {m.from > 0 && <Icon name="forward" size={22} />}
                    <span className={s.levelNew}>
                      <Badge level={m.to} size={50} showLabel />
                    </span>
                  </span>
                </div>
              ))}
              {result.replayed.map((id) => {
                const p = progress?.[id];
                const nextLevel = Math.min(6, (p?.level ?? 0) + 1) as Level;
                const days = p?.dueDay && today ? Math.max(0, daysBetween(today, p.dueDay)) : null;
                return (
                  <div key={id} className={s.levelRow} data-replayed={id}>
                    <img src={sceneOf(id)?.thumb} alt="" className={s.levelThumb} />
                    <span className={s.levelScene}>{sceneOf(id)?.titleFr ?? id}</span>
                    {p && <Badge level={p.level} size={34} />}
                    <span className={s.later}>
                      {p && p.level >= 6
                        ? t('home.level.max')
                        : days !== null
                          ? t('practice.result.nextIn', { level: t(`common.level.${nextLevel}` as TKey), n: days })
                          : t('practice.result.replay')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {result.achievements.length > 0 && (
            <div className={cx(s.panel, s.panelAch, beat >= 5 && s.panelIn)} style={{ '--tilt': '1.5deg' } as CSSProperties}>
              <span className={s.panelLabel}>{t('practice.result.achievements')}</span>
              {result.achievements.map((id) => {
                const a = ACHIEVEMENTS_BY_ID.get(id);
                return (
                  <div key={id} className={s.achRow}>
                    <Icon name="trophy" size={30} />
                    <span>
                      <b>{a ? a.name[lang] : id}</b>
                      {a?.rewardName && <small> · {a.rewardName[lang]}</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className={s.onward}>
        <Button color="yellow" size="xl" block iconRight="forward" onClick={onContinue} data-results-continue>
          {result?.chest ? t('practice.result.openChest') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
