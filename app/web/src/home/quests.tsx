// Home's daily quests (docs/app-rules.md, "Daily quests"): one comic panel per quest, in order, with
// the chest it gives; the one obvious next thing to do is the loudest. And the streak's week of light
// and full days.
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Streak } from '../../../shared/api';
import type { SceneSummary } from '../../../shared/content';
import { getLanguage, t } from '../../../shared/i18n';
import { MAX_LEVEL, type Level } from '../../../shared/rules';
import { fx } from '../fx';
import { ChestArt } from '../loot/ChestArt';
import { Badge, cx, Icon, Spinner } from '../ui';
import { listNumbers, type QuestCard } from './logic';
import { PracticeBar } from './practice';
import s from './quests.module.css';

const levelName = (level: number) => t(`common.level.${Math.min(MAX_LEVEL, Math.max(1, level)) as Level}` as const);

/** "Finish quest 1 first" / "Finish quests 1, 2 and 3 first". */
export function waitingText(numbers: readonly number[]): string {
  return t('home.quests.locked', { n: numbers.length, list: listNumbers(numbers, t('home.quests.and')) });
}

export interface QuestListProps {
  cards: QuestCard[];
  scenes: Map<string, SceneSummary> | undefined;
  /** The index of the quest whose practice is starting. */
  busyIndex: number | null;
  onTap: (card: QuestCard) => void;
  onChest: (chestId: string) => void;
}

/** The quests in order; those "Do more" added come after a heading of their own. */
export function QuestList({ cards, scenes, busyIndex, onTap, onChest }: QuestListProps) {
  const firstExtra = cards.findIndex((c) => c.quest.extra);
  // Once "Do more" added quests to do, the finished ones above them fold to one line each, so the
  // next quest stays near the top of a phone's screen.
  const fold = cards.some((c) => c.quest.extra && c.state !== 'done');
  // Under the header, the next quest can still sit below the fold of a phone (after "Do more", under the
  // day's folded quests; on a small phone, the first one): on arriving at Home, bring it into view. Once:
  // never again while the kid is there, so the list does not move under a finger.
  const next = cards.find((c) => c.state === 'next');
  const list = useRef<HTMLOListElement>(null);
  const shown = useRef(false);
  useEffect(() => {
    // Not before the scenes are known: a scene's title makes its card taller.
    if (!next || shown.current || (next.quest.sceneId && !scenes)) return;
    shown.current = true;
    const index = next.quest.index;
    // Once the comic fonts are in: they change the cards' heights.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-testid="quest"][data-index="${index}"]`);
      el?.scrollIntoView?.({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' });
    });
  }, [next, scenes]);
  return (
    <ol className={s.list} data-testid="quests" ref={list}>
      {cards.map((card, i) => (
        <li key={card.quest.index} className={s.item} style={{ '--i': i } as CSSProperties}>
          {i === firstExtra && (
            <span className={s.extraHead} data-quests-extra>
              <Icon name="plus" size={18} /> {t('home.quests.extra')}
            </span>
          )}
          <QuestRow card={card} scene={card.quest.sceneId ? scenes?.get(card.quest.sceneId) : undefined} busy={busyIndex === card.quest.index} folded={fold && card.state === 'done'} onTap={() => onTap(card)} onChest={onChest} />
        </li>
      ))}
    </ol>
  );
}

function QuestRow({ card, scene, busy, folded, onTap, onChest }: { card: QuestCard; scene: SceneSummary | undefined; busy: boolean; folded: boolean; onTap: () => void; onChest: (id: string) => void }) {
  const { quest: q, state } = card;
  const choose = q.kind === 'choose';
  const done = state === 'done';
  const doable = state === 'next' || state === 'open';
  const practice = q.practice;
  let title: string;
  let sub: string | null = null;
  if (choose) {
    title = t('home.quests.choose', { n: q.target });
  } else if (scene) {
    title = t('home.quests.pass', { level: levelName(q.level) });
    sub = scene.titleFr;
  } else {
    title = t('home.quests.place', { level: levelName(q.level) });
  }
  const action = choose ? t('home.quests.chooseGo') : practice ? t('home.quests.continue') : t('home.quests.play');
  return (
    <div
      className={cx(s.quest, s[state], choose && s.choose, done && s.compact, folded && s.folded)}
      data-testid="quest"
      data-index={q.index}
      data-kind={q.kind}
      data-state={state}
      data-scene={q.sceneId ?? undefined}
      data-level={q.level || undefined}
      data-reason={q.reason ?? undefined}
      data-extra={q.extra || undefined}
      data-chosen={choose ? `${q.chosen}/${q.target}` : undefined}
    >
      <button type="button" className={s.main} onClick={onTap} disabled={busy} aria-label={`${t('home.quests.number', { n: card.number })}: ${title}${sub ? ` · ${sub}` : ''}${done ? ` · ${t('home.quests.done')}` : ''}`}>
        <span className={s.no}>{t('home.quests.number', { n: card.number })}</span>
        <span className={s.art}>
          {choose ? (
            <span className={s.chooseArt}>
              <Icon name={state === 'locked' ? 'lock' : 'unlock'} size={done ? 24 : 34} />
            </span>
          ) : scene ? (
            <img className={s.thumb} src={scene.thumb} alt="" draggable={false} />
          ) : (
            <span className={s.mystery}>?</span>
          )}
          {!choose && q.level > 0 && (
            <span className={s.badge}>
              <Badge level={Math.min(MAX_LEVEL, q.level) as Level} size={done ? 20 : 28} />
            </span>
          )}
          {done && (
            <span className={s.check}>
              <Icon name="check" size={20} />
            </span>
          )}
        </span>
        <span className={s.text}>
          <strong className={s.title}>{title}</strong>
          {sub && <span className={s.sceneTitle}>{sub}</span>}
          {!done && <QuestStatus card={card} />}
        </span>
        {doable && (
          <span className={s.go} aria-hidden>
            {busy ? <Spinner /> : <Icon name={choose ? 'forward' : 'play'} size={22} />}
            <span className={s.goText}>{action}</span>
          </span>
        )}
        {done && <span className={s.doneTag}>{t('home.quests.done')}</span>}
      </button>
      <button
        type="button"
        className={cx(s.chest, card.chestWaiting && s.chestReady)}
        onClick={() => (card.chestWaiting && q.chestId ? onChest(q.chestId) : onTap())}
        aria-label={`${t(`chest.kind.${q.chest}` as const)}${card.chestWaiting ? ` · ${t('home.quests.openChest')}` : ''}`}
        data-quest-chest={card.chestWaiting ? 'ready' : done ? 'opened' : 'waiting'}
      >
        <ChestArt kind={q.chest} size={done ? 40 : 52} empty={done && !card.chestWaiting} />
        {card.chestWaiting && <span className={s.chestTag}>{t('home.quests.openChest')}</span>}
      </button>
    </div>
  );
}

/** The line under a quest's title: what it waits for, how far it is, why it is here. */
function QuestStatus({ card }: { card: QuestCard }) {
  const q = card.quest;
  if (q.kind === 'choose') {
    if (card.state === 'locked') {
      return (
        <span className={cx(s.status, s.lockedText)} data-waiting-for={card.waitingNumbers.join(',')}>
          <Icon name="lock" size={16} /> {waitingText(card.waitingNumbers)}
        </span>
      );
    }
    return (
      <span className={s.status}>
        <span className={s.keys} aria-hidden>
          {Array.from({ length: q.target }, (_, i) => (
            <span key={i} className={cx(s.key, i < q.chosen && s.keyOn)} />
          ))}
        </span>
        {t('home.quests.chosen', { n: q.chosen, total: q.target })}
      </span>
    );
  }
  if (!q.sceneId) return <span className={s.status}>{t('home.quests.placeHint')}</span>;
  if (q.practice) return <PracticeBar practice={q.practice} small className={s.bar} />;
  return <span className={cx(s.status, s.reason)}>{t(`home.quests.reason.${q.reason ?? 'new'}` as const)}</span>;
}

/** The week of the streak: one box per day, light or full, a potion for a saved day; today last. */
export function StreakWeek({ streak, className }: { streak: Streak; className?: string }) {
  const fmt = weekdayFormat();
  const days = streak.week;
  const today = streak.fullToday ? 'full' : streak.doneToday ? 'light' : 'none';
  return (
    <div className={cx(s.week, className)} data-streak-week data-today={today}>
      <span className={s.weekDays}>
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          return (
            <span key={d.day} className={cx(s.day, s[`day_${d.kind}`], isToday && s.today)} data-day={d.day} data-kind={d.kind} title={t(`home.streak.kind.${d.kind}` as const)} aria-label={`${fmt(d.day)}: ${t(`home.streak.kind.${d.kind}` as const)}`} role="img">
              <span className={s.dayName}>{fmt(d.day)}</span>
              <span className={s.dayMark}>{d.kind === 'saved' ? <Icon name="potion" size={18} /> : d.kind === 'none' ? null : <MiniFlame full={d.kind === 'full'} />}</span>
            </span>
          );
        })}
      </span>
      <span className={s.weekText}>{t(today === 'none' && streak.count === 0 ? 'home.streak.today.start' : (`home.streak.today.${today}` as const))}</span>
      <span className={s.legend} aria-hidden>
        <span className={cx(s.legendBox, s.day_light)}>
          <MiniFlame full={false} />
        </span>
        {t('home.streak.light')}
        <span className={cx(s.legendBox, s.day_full)}>
          <MiniFlame full />
        </span>
        {t('home.streak.full')}
      </span>
    </div>
  );
}

function weekdayFormat(): (day: string) => string {
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat(getLanguage() === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'narrow', timeZone: 'UTC' });
  } catch {
    // no Intl: the day of the month
  }
  return (day) => (f ? f.format(new Date(`${day}T12:00:00Z`)).toUpperCase() : day.slice(8));
}

/** A small flame: hollow for a light day, full with its yellow heart for a full day. */
function MiniFlame({ full }: { full: boolean }) {
  return (
    <svg viewBox="0 0 64 72" width={18} height={20} aria-hidden>
      <path d="M32 3C36 17 52 24 52 44a20 20 0 0 1-40 0c0-9 4-15 9-20 0 7 3 11 7 12-3-11 0-23 4-33z" fill={full ? 'var(--tomato)' : 'var(--white)'} stroke="var(--ink)" strokeWidth="6" strokeLinejoin="round" />
      {full && <path d="M32 30c3 7 10 10 10 19a10 10 0 0 1-20 0c0-5 3-8 5-10 0 3 2 5 4 5-1-5 0-10 1-14z" fill="var(--yellow)" />}
    </svg>
  );
}
