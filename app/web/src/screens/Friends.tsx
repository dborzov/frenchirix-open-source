// OWNER: the social step (meta agent). Route /friends: search, follow, friends with streaks, news, cheers and gifts, inbox.
import { useEffect, useState, type CSSProperties } from 'react';
import type { FeedItem, Friend, Gift, InboxEntry, PublicProfile } from '../../../shared/api';
import { CHEERS, CHEERS_BY_ID, ITEMS_BY_ID } from '../../../shared/catalog';
import { getLanguage, t } from '../../../shared/i18n';
import { api } from '../api';
import { Avatar, CheerSticker, ItemIcon } from '../avatar';
import { fx } from '../fx';
import { Balloon, Caption, CoverTag } from '../home/comic';
import { feedIcon, feedText } from '../home/feed';
import { errorText, useAsync } from '../home/hooks';
import { Loading, LoadError, ScreenTitle } from '../home/parts';
import { usePlayer, usePlayerState } from '../state/player';
import { actionFailed } from '../state/recover';
import { Button, Chip, cx, EmptyState, Icon, Sheet, toast, useLayout } from '../ui';
import s from './Friends.module.css';

type Tab = 'friends' | 'news' | 'inbox' | 'search';

export default function FriendsScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const tablet = layout === 'tablet';
  const [tab, setTab] = useState<Tab>('friends');
  const friends = useAsync(() => api.friends());
  const [target, setTarget] = useState<Friend | null>(null);
  const [cheered, setCheered] = useState<Set<string>>(new Set());

  const cheerFeed = async (item: FeedItem) => {
    try {
      const res = await api.gift({ toUserId: item.user.id, gift: { kind: 'cheer', cheerId: CHEERS[0]!.id, feedItemId: item.id } });
      usePlayer.getState().apply(res.patch);
      setCheered((c) => new Set(c).add(item.id));
      fx.sfx('pop');
    } catch (e) {
      actionFailed(e);
    }
  };

  const list = friends.error ? (
    <LoadError error={friends.error} onRetry={friends.reload} />
  ) : !friends.data ? (
    <Loading />
  ) : friends.data.friends.length === 0 ? (
    <EmptyState icon="friends" color="lime" title={t('social.noFriends')} text={t('social.noFriendsText')} action={!tablet ? <Button icon="plus" onClick={() => setTab('search')}>{t('social.find')}</Button> : undefined} />
  ) : (
    <div className={s.list}>
      {friends.data.friends.map((f, i) => (
        <button key={f.id} type="button" className={s.friend} style={{ '--i': i } as CSSProperties} onClick={() => setTarget(f)}>
          <span className={s.friendAvatar}>
            <Avatar avatar={f.avatar} size={56} />
            {f.practisedToday && <span className={s.today}>{t('social.today')}</span>}
          </span>
          <span className={s.friendMain}>
            <span className={s.friendName}>{f.name}</span>
            <span className={s.friendMeta}>
              <span className={s.metaTag}>{t('social.rank', { n: f.xpRank })}</span>
              <span className={s.metaTag}>
                <Icon name="flame" size={16} /> {f.streak}
              </span>
            </span>
          </span>
          {f.friendStreak > 0 && (
            <span className={s.duo} aria-label={t('social.friendStreak', { n: f.friendStreak })}>
              <Icon name="flame" size={20} />
              <Icon name="flame" size={20} />
              <strong>{f.friendStreak}</strong>
            </span>
          )}
          <span className={s.giftIcon}>
            <Icon name="gift" size={24} />
          </span>
        </button>
      ))}
    </div>
  );

  const news = friends.data ? (
    friends.data.feed.length === 0 ? (
      <p className={s.quiet}>{t('social.noNews')}</p>
    ) : (
      <div className={s.feed}>
        {friends.data.feed.map((item, i) => {
          const done = item.cheeredByMe || cheered.has(item.id);
          return (
            <div key={item.id} className={s.feedItem} style={{ '--i': i } as CSSProperties}>
              <Avatar avatar={item.user.avatar} size={48} />
              <Balloon tail="bottom-left" className={s.feedBalloon}>
                <Icon name={feedIcon(item)} size={18} /> {feedText(item)}
              </Balloon>
              <Button size="sm" color={done ? 'white' : 'yellow'} disabled={done} onClick={() => void cheerFeed(item)} aria-label={t('social.cheer')}>
                {done ? <Icon name="check" size={20} /> : t('social.bravo')}
              </Button>
            </div>
          );
        })}
      </div>
    )
  ) : null;

  const tabs: [Tab, string, number?][] = [
    ['friends', t('social.tab.friends')],
    ['news', t('social.tab.news')],
    ['inbox', t('social.tab.inbox'), st.inboxUnread],
    ['search', t('social.tab.search')],
  ];

  return (
    <div className={cx(s.page, tablet && s.tablet)}>
      <ScreenTitle icon="friends" color="lime">
        {t('social.title')}
      </ScreenTitle>
      {tablet ? (
        <div className={s.columns}>
          <div>
            <Search onFollowed={friends.reload} />
            <Caption as="h2">{t('social.tab.friends')}</Caption>
            <div className={s.gap} />
            {list}
          </div>
          <div>
            <Caption as="h2" color="cyan">
              {t('social.tab.news')}
            </Caption>
            <div className={s.gap} />
            {news ?? <Loading />}
            <div className={s.gap} />
            <Caption as="h2" color="orange">
              {t('social.tab.inbox')}
            </Caption>
            <div className={s.gap} />
            <Inbox />
          </div>
        </div>
      ) : (
        <>
          <div className={s.tabs} role="tablist">
            {tabs.map(([k, label, n]) => (
              <Chip key={k} selected={tab === k} onClick={() => setTab(k)} color="lime" data-tab={k}>
                {label}
                {n ? <span className={s.count}>{n}</span> : null}
              </Chip>
            ))}
          </div>
          {tab === 'friends' && list}
          {tab === 'news' && (news ?? <Loading />)}
          {tab === 'inbox' && <Inbox />}
          {tab === 'search' && <Search onFollowed={friends.reload} />}
        </>
      )}
      <GiftSheet friend={target} onClose={() => setTarget(null)} onUnfollowed={() => { setTarget(null); friends.reload(); }} />
    </div>
  );
}

function Search({ onFollowed }: { onFollowed: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      api.search(term).then(
        (r) => live && (setResults(r.users), setError(null)),
        (e) => live && setError(errorText(e)),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);
  const toggle = async (u: PublicProfile) => {
    try {
      const res = u.following ? await api.unfollow(u.id) : await api.follow(u.id);
      usePlayer.getState().apply(res.patch);
      setResults((rs) => rs?.map((x) => (x.id === u.id ? res.user : x)) ?? null);
      if (!u.following) fx.sfx('pop');
      onFollowed();
    } catch (e) {
      actionFailed(e);
    }
  };
  return (
    <div className={s.search}>
      <label className={s.searchBox}>
        <Icon name="friends" size={24} />
        <input className={s.searchInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('social.searchPlaceholder')} aria-label={t('social.tab.search')} autoCapitalize="off" spellCheck={false} data-friend-search />
      </label>
      {error && <p className={s.quiet}>{error}</p>}
      {results && results.length === 0 && <p className={s.quiet}>{t('social.nobody')}</p>}
      {results && results.length > 0 && (
        <div className={s.list}>
          {results.map((u) => (
            <div key={u.id} className={s.friend}>
              <Avatar avatar={u.avatar} size={48} />
              <span className={s.friendMain}>
                <span className={s.friendName}>{u.name}</span>
                <span className={s.friendMeta}>
                  <span className={s.metaTag}>{t('social.rank', { n: u.xpRank })}</span>
                  {u.followsMe && <span className={s.metaTag}>{t('social.followsYou')}</span>}
                </span>
              </span>
              <Button size="sm" color={u.following ? 'white' : 'green'} icon={u.following ? 'check' : 'plus'} onClick={() => void toggle(u)} data-follow={u.following ? 'following' : 'follow'}>
                {u.following ? t('social.following') : t('social.follow')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Inbox() {
  const inbox = useAsync(async () => {
    const res = await api.inbox();
    usePlayer.getState().apply(res.patch);
    return res.entries;
  });
  if (inbox.error) return <LoadError error={inbox.error} onRetry={inbox.reload} />;
  if (!inbox.data) return <Loading />;
  if (!inbox.data.length) return <p className={s.quiet}>{t('social.inboxEmpty')}</p>;
  return (
    <div className={s.feed}>
      {inbox.data.map((e, i) => (
        <div key={e.id} className={cx(s.inboxItem, !e.seen && s.unseen)} style={{ '--i': i } as CSSProperties} data-inbox={e.gift.kind}>
          <Avatar avatar={e.from.avatar} size={48} />
          <span className={s.inboxText}>{inboxText(e)}</span>
          {e.gift.kind === 'cheer' && CHEERS_BY_ID.get(e.gift.cheerId) ? <CheerSticker cheerId={e.gift.cheerId} size={52} /> : e.gift.kind === 'item' ? <ItemIcon itemId={e.gift.itemId} size={48} /> : <Icon name={e.gift.kind === 'potion' ? 'potion' : 'gift'} size={36} />}
        </div>
      ))}
    </div>
  );
}

function inboxText(e: InboxEntry): string {
  const name = e.from.name;
  const g = e.gift;
  if (g.kind === 'cheer') return t('social.got.cheer', { name, what: CHEERS_BY_ID.get(g.cheerId)?.name[getLanguage()] ?? '' });
  if (g.kind === 'potion') return t('social.got.potion', { name });
  return t('social.got.item', { name, what: ITEMS_BY_ID.get(g.itemId)?.name[getLanguage()] ?? g.itemId });
}

function GiftSheet({ friend, onClose, onUnfollowed }: { friend: Friend | null; onClose: () => void; onUnfollowed: () => void }) {
  const st = usePlayerState();
  const [busy, setBusy] = useState(false);
  if (!friend) return <Sheet open={false} onClose={onClose} />;
  const send = async (gift: Gift) => {
    setBusy(true);
    try {
      const res = await api.gift({ toUserId: friend.id, gift });
      usePlayer.getState().apply(res.patch);
      fx.sfx('win');
      fx.confetti({ count: 50 });
      toast(t('social.sent', { name: friend.name }), { color: 'green', icon: 'gift', tag: 'sent' });
      onClose();
    } catch (e) {
      actionFailed(e);
    } finally {
      setBusy(false);
    }
  };
  const unfollow = async () => {
    try {
      const res = await api.unfollow(friend.id);
      usePlayer.getState().apply(res.patch);
      onUnfollowed();
    } catch (e) {
      actionFailed(e);
    }
  };
  const owned = Object.entries(st.inventory).filter(([id, n]) => n > 0 && ITEMS_BY_ID.has(id) && !ITEMS_BY_ID.get(id)!.sources.some((src) => src.kind === 'starter'));
  return (
    <Sheet open onClose={onClose} title={friend.name} color="lime">
      <div className={s.sheet}>
        <div className={s.sheetHead}>
          <Avatar avatar={friend.avatar} size={84} />
          <div className={s.sheetTags}>
            <CoverTag color="yellow">
              <Icon name="flame" size={18} /> {friend.streak}
            </CoverTag>
            {friend.friendStreak > 0 && <CoverTag color="tomato">{t('social.friendStreak', { n: friend.friendStreak })}</CoverTag>}
            <CoverTag color="white">{t('social.weekXp', { n: friend.weekXp })}</CoverTag>
          </div>
        </div>
        <Caption as="h3">{t('social.sendCheer')}</Caption>
        <div className={s.cheers}>
          {CHEERS.map((c) => (
            <button key={c.id} type="button" className={s.cheerButton} disabled={busy} onClick={() => void send({ kind: 'cheer', cheerId: c.id })} data-cheer={c.id}>
              <CheerSticker cheerId={c.id} size={60} />
              <span>{c.name[getLanguage()]}</span>
            </button>
          ))}
        </div>
        <Caption as="h3" color="purple">
          {t('social.sendGift')}
        </Caption>
        <div className={s.gifts}>
          <Button color="purple" icon="potion" disabled={busy || st.currencies.potions < 1} onClick={() => void send({ kind: 'potion' })}>
            {t('social.sendPotion', { n: st.currencies.potions })}
          </Button>
          {owned.map(([id]) => (
            <button key={id} type="button" className={s.itemGift} disabled={busy} onClick={() => void send({ kind: 'item', itemId: id })}>
              <ItemIcon itemId={id} size={52} />
              <span>{ITEMS_BY_ID.get(id)!.name[getLanguage()]}</span>
            </button>
          ))}
        </div>
        <Button size="sm" color="white" onClick={() => void unfollow()} className={s.unfollow}>
          {t('social.unfollow')}
        </Button>
      </div>
    </Sheet>
  );
}
