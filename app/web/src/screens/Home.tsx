// Route /: today at a glance and one obvious next thing to tap. The day's quests in order (choose new
// scenes, or pass a scene's practice at a level), each with its chest; the streak's week; "Do more"
// once every quest is done (docs/app-rules.md, "Daily quests").
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { t } from '../../../shared/i18n';
import { DAILY_CANDIDATES, xpForRank, xpRank } from '../../../shared/rules';
import { api } from '../api';
import { Avatar } from '../avatar/Avatar';
import { fx } from '../fx';
import { feedIcon, feedText } from '../home/feed';
import { useAsync, useDoMore, useIndex, useRefreshState, useStartPractice, type IndexData } from '../home/hooks';
import { allUnlocked, dayQuestCount, pickForDay, practiceQueue, questCards, type QuestCard } from '../home/logic';
import { PracticeBar } from '../home/practice';
import { Burst, CoverTag } from '../home/comic';
import { nextLevelText, SceneThumb, SectionTitle, StreakFlame } from '../home/parts';
import { QuestList, StreakWeek, waitingText } from '../home/quests';
import { ChestArt } from '../loot/ChestArt';
import { AvatarInvite, needsWelcome, NotePinCard, shouldInvite, shouldNotePin, Tip, useWelcomeAfterWelcomeBack, Welcome } from '../onboarding';
import { InstallOffer } from '../pwa';
import { usePlayerState } from '../state/player';
import { Button, cx, Icon, ProgressBar, Spinner, toast, useLayout } from '../ui';
import s from './Home.module.css';

const KaraokePlayer = lazy(() => import('./KaraokePlayer'));

export default function HomeScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const tablet = layout === 'tablet';
  const [, navigate] = useLocation();
  const idx = useIndex();
  const { start, busy } = useStartPractice();
  const [tapped, setTapped] = useState<number | null>(null);
  const toUnlock = useCallback(() => navigate('/unlock'), [navigate]);
  const doMore = useDoMore(toUnlock);
  const [welcome, setWelcome] = useState(() => needsWelcome(st));
  // The welcome waits for "Played before?" (pwa/Overlay.tsx), so the two never stack. A kid who answers
  // it by tapping their name ("Who's playing?") is logged in under this Home: no welcome for them.
  const welcomeNow = useWelcomeAfterWelcomeBack(welcome && needsWelcome(st), st);
  const [invite, setInvite] = useState(() => shouldInvite(st));
  const [notePin, setNotePin] = useState(false);
  // The copy in the store may be from yesterday, or from before a practice finished elsewhere.
  useRefreshState();
  const wantsNotePin = shouldNotePin(st);

  const cards = useMemo(() => questCards(st), [st]);
  const count = dayQuestCount(st.daily);
  const everyQuestDone = cards.length > 0 && cards.every((c) => c.state === 'done');
  const everything = idx.data ? allUnlocked(st, idx.data.index.scenes.length) : false;
  const questChestIds = new Set(cards.map((c) => c.quest.chestId).filter(Boolean));
  const otherChests = st.chests.filter((c) => !questChestIds.has(c.id));
  const chooseCard = cards.find((c) => c.quest.kind === 'choose' && !c.quest.done);

  const onTap = (card: QuestCard) => {
    const q = card.quest;
    if (card.state === 'done') {
      if (card.chestWaiting && q.chestId) navigate(`/chest/${encodeURIComponent(q.chestId)}`);
      else if (q.sceneId) navigate(`/scene/${encodeURIComponent(q.sceneId)}`);
      return;
    }
    if (q.kind === 'choose' || !q.sceneId) {
      // A place for a scene not chosen yet opens the choice too, unless choosing waits for other quests.
      const lock = q.kind === 'choose' ? card : chooseCard?.state === 'locked' ? chooseCard : null;
      if (lock && lock.state === 'locked') {
        toast(waitingText(lock.waitingNumbers), { color: 'white', icon: 'lock' });
        return;
      }
      navigate('/unlock');
      return;
    }
    setTapped(q.index);
    void start({ kind: 'scene', sceneId: q.sceneId });
  };

  const header = (
    <Header
      name={st.profile.name}
      avatar={<Avatar avatar={st.profile.avatar} size={tablet ? 88 : 72} />}
      streak={st.streak.count}
      alive={st.streak.doneToday}
      xp={st.currencies.xp}
      left={cards.filter((c) => c.state !== 'done').length}
      onAvatar={() => navigate('/profile')}
      week={<StreakWeek streak={st.streak} />}
    />
  );

  const today = (
    <>
      {everyQuestDone && <DoneToday canMore={st.daily.doMore} onMore={() => void doMore.more()} busy={doMore.busy} onScenes={() => navigate('/episodes')} onSing={() => navigate('/karaoke')} />}
      {everything && cards.length === 0 && <AllUnlocked onScenes={() => navigate('/episodes')} />}
      {cards.length > 0 && (
        <section className={s.questsWrap} data-testid="daily-quests" data-quests-done={st.daily.questsDone || undefined} data-do-more={st.daily.doMore || undefined}>
          <SectionTitle right={<span className={s.questCount} data-quest-count={`${count.done}/${count.total}`}>{t('home.quests.count', { n: count.done, total: count.total })}</span>}>{t('home.quests.title')}</SectionTitle>
          {!everyQuestDone && (
            <Tip id="home-quests" placement="inline" className={s.tip}>
              {t('home.tip.quests')}
            </Tip>
          )}
          <QuestList cards={cards} scenes={idx.data?.byId} busyIndex={busy ? tapped : null} onTap={onTap} onChest={(id) => navigate(`/chest/${encodeURIComponent(id)}`)} />
        </section>
      )}
      {/* After the quests: the one thing to do next stays at the top. */}
      {wantsNotePin && !notePin && <NotePinCard state={st} onDone={() => setNotePin(true)} />}
      {invite && <AvatarInvite state={st} onDismiss={() => setInvite(false)} />}
    </>
  );

  const side = (
    <>
      {otherChests.length > 0 && (
        <button type="button" className={s.chests} onClick={() => navigate(`/chest/${encodeURIComponent(otherChests[0]!.id)}`)}>
          <div className={s.chestsRow}>
            {otherChests.slice(0, 3).map((c, i) => (
              <ChestArt key={c.id} kind={c.kind} size={56} className={s.chestBob} style={{ animationDelay: `${i * 180}ms` }} />
            ))}
          </div>
          <div className={s.chestsText}>
            <strong>{t('home.chests.title', { n: otherChests.length })}</strong>
            <span>{t('home.chests.open')}</span>
          </div>
        </button>
      )}
      <ComeBack idx={idx.data} />
      <KaraokeCard idx={idx.data} day={st.today} />
      <InstallOffer />
      <FriendsNews />
    </>
  );

  return (
    <div className={cx(s.home, tablet && s.tablet)}>
      {welcomeNow && <Welcome onDone={() => setWelcome(false)} />}
      {header}
      {tablet ? (
        <div className={s.columns}>
          <div className={s.colMain}>{today}</div>
          <div className={s.colSide}>{side}</div>
        </div>
      ) : (
        <>
          {today}
          {side}
        </>
      )}
    </div>
  );
}

function Header({ name, avatar, streak, alive, xp, left, onAvatar, week }: { name: string; avatar: React.ReactNode; streak: number; alive: boolean; xp: number; left: number; onAvatar: () => void; week: React.ReactNode }) {
  const rank = xpRank(xp);
  const from = xpForRank(rank);
  const to = xpForRank(rank + 1);
  return (
    <div className={s.header}>
      <CoverTag className={s.cover} color="yellow" tilt={-4}>
        {t('home.cover', { n: streak })}
      </CoverTag>
      <div className={s.headerTop}>
        <button type="button" className={s.avatarButton} onClick={onAvatar} aria-label={t('nav.profile')}>
          {avatar}
          <span className={s.rankBadge}>{rank}</span>
        </button>
        <div className={s.hello}>
          <h1 className={s.helloText} data-home-hello>{t('home.hello', { name })}</h1>
          <p className={s.helloSub}>{left > 0 ? t('home.sub.left', { n: left }) : t('home.sub.done')}</p>
          <ProgressBar value={xp - from} max={to - from} color="lime" height={16} ariaLabel={t('home.rankProgress', { n: rank })} className={s.xpBar} />
        </div>
        <StreakFlame count={streak} alive={alive} size={60} />
      </div>
      <div className={s.headerWeek}>{week}</div>
    </div>
  );
}

/** Every quest of the day done (the extra ones too): a burst, and "Do more" while scenes are left. */
function DoneToday({ canMore, onMore, busy, onScenes, onSing }: { canMore: boolean; onMore: () => void; busy: boolean; onScenes: () => void; onSing: () => void }) {
  // On a short phone (375x667) "Do more" sits under the tab bar: bring the card into view once on
  // arrival, as the quest list does with the next quest (never again, so nothing moves under a finger).
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void (document.fonts?.ready ?? Promise.resolve()).then(() => card.current?.scrollIntoView?.({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' }));
  }, []);
  return (
    <div className={s.doneCard} data-testid="quests-done" ref={card}>
      <Burst word={t('home.done.burst')} size={130} color="yellow" seed={11} />
      <h2>{t('home.done.title')}</h2>
      <p>{canMore ? t('home.done.textMore', { n: DAILY_CANDIDATES }) : t('home.done.text')}</p>
      {canMore ? (
        <Button color="accent" size="xl" icon="plus" onClick={onMore} loading={busy} className={s.doMore} data-do-more-button>
          {t('home.quests.doMore')}
        </Button>
      ) : (
        <div className={s.doneButtons}>
          <Button color="cyan" icon="episodes" size="sm" onClick={onScenes}>
            {t('home.done.watch')}
          </Button>
          <Button color="purple" icon="karaoke" size="sm" onClick={onSing}>
            {t('home.done.sing')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The kid's unlocked scenes, the started practices first with their progress. */
function ComeBack({ idx }: { idx: IndexData | undefined }) {
  const st = usePlayerState();
  const [, navigate] = useLocation();
  const queue = practiceQueue(st);
  const ready = queue.filter((c) => c.practice || c.next.state === 'now').length;
  return (
    <section className={s.comeBack} data-testid="practice-queue">
      <SectionTitle right={ready > 0 ? <span className={s.dueCount} data-due-count={ready}>{t('home.queue.ready', { n: ready })}</span> : undefined}>{t('home.comeBack.title')}</SectionTitle>
      {queue.length === 0 ? (
        <div className={cx(s.panel, s.emptyRow)}>
          <Icon name="episodes" size={32} />
          <span>{t('home.comeBack.empty')}</span>
        </div>
      ) : !idx ? (
        <div className={s.rowLoading}>
          <Spinner />
        </div>
      ) : (
        <div className={cx(s.panel, s.thumbRow)}>
          {queue.map((c, i) => {
            const scene = idx.byId.get(c.sceneId);
            if (!scene) return null;
            const isDue = !c.practice && c.next.state === 'now';
            return (
              <div key={c.sceneId} className={s.thumbCell} style={{ '--i': i } as CSSProperties} data-testid="queue-item" data-scene={c.sceneId} data-kind={c.practice ? (c.practice.replay ? 'replay' : 'continue') : isDue ? 'due' : 'later'}>
                <SceneThumb scene={scene} progress={c.progress} due={isDue || !!c.practice} size={76} onClick={() => navigate(`/scene/${encodeURIComponent(c.sceneId)}`)} />
                {c.practice ? <PracticeBar practice={c.practice} small className={s.queueBar} /> : <span className={cx(s.thumbLabel, isDue && s.thumbLabelDue)}>{nextLevelText(c.next, true)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AllUnlocked({ onScenes }: { onScenes: () => void }) {
  return (
    <div className={s.doneCard} data-testid="all-unlocked">
      <Burst word={t('home.all.burst')} size={130} color="yellow" seed={13} />
      <h2>{t('home.all.title')}</h2>
      <p>{t('home.all.text')}</p>
      <Button color="accent" size="lg" icon="episodes" onClick={onScenes}>
        {t('home.done.watch')}
      </Button>
    </div>
  );
}

function KaraokeCard({ idx, day }: { idx: IndexData | undefined; day: string }) {
  const [, navigate] = useLocation();
  const song = idx ? pickForDay(idx.index.songs, day) : undefined;
  return (
    <section className={s.karaoke}>
      <SectionTitle
        right={
          <Button color="purple" size="sm" iconRight="forward" onClick={() => navigate('/karaoke')}>
            {t('home.karaoke.all')}
          </Button>
        }
      >
        {t('home.karaoke.title')}
      </SectionTitle>
      <div className={cx(s.panel, s.karaokeCard)} data-karaoke-card={song?.id ?? 'loading'}>
        {song ? (
          <Suspense fallback={<Spinner size="lg" label={t('common.loading')} />}>
            <KaraokePlayer params={{ id: song.id }} />
          </Suspense>
        ) : (
          <Spinner size="lg" label={t('common.loading')} />
        )}
      </div>
    </section>
  );
}

function FriendsNews() {
  const [, navigate] = useLocation();
  const friends = useAsync(() => api.friends());
  const feed = friends.data?.feed.slice(0, 3) ?? [];
  if (!feed.length) return null; // quiet when there is nothing, or when it failed
  return (
    <section>
      <SectionTitle
        right={
          <Button color="lime" size="sm" iconRight="forward" onClick={() => navigate('/friends')}>
            {t('home.friends.all')}
          </Button>
        }
      >
        {t('home.friends.title')}
      </SectionTitle>
      <div className={s.news}>
        {feed.map((item, i) => (
          <div key={item.id} className={s.newsItem} style={{ '--i': i } as CSSProperties}>
            <Avatar avatar={item.user.avatar} size={44} />
            <span className={s.newsText}>{feedText(item)}</span>
            <span className={s.newsIcon}>
              <Icon name={feedIcon(item)} size={24} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
