// OWNER: the avatar step. Route /avatar: the avatar editor, laid out as a comic page. A cover panel
// with the live avatar; tabs of categories; a grid of small inked panels per tab. Opened from the
// onboarding invitation (?from=invite) or before the kid has chosen a name, it also asks for a name.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearch } from 'wouter';
import {
  ACHIEVEMENTS_BY_ID,
  AVATAR_BASE_OPTIONS,
  AVATAR_VERSION,
  ITEMS,
  STARTER_ITEM_IDS,
  randomAvatar,
  resolveBase,
  validateAvatar,
  type Avatar as AvatarData,
  type AvatarBaseKey,
  type Item,
  type ItemSlot,
  type Rarity,
} from '../../../shared/catalog';
import { checkName } from '../../../shared/catalog/badwords';
import { randomName } from '../../../shared/catalog/names';
import type { TKey } from '../../../shared/i18n';
import { xpRank } from '../../../shared/rules';
import { api, ApiRequestError } from '../api';
import { Avatar } from '../avatar/Avatar';
import { ItemIcon } from '../avatar/ItemIcon';
import { BG, HAIR, SKIN } from '../avatar/palette';
import { fx } from '../fx';
import { usePlayer, usePlayerState, useT } from '../state/player';
import { actionFailed } from '../state/recover';
import { Balloon, Button, cx, Stamp, toast, useLayout } from '../ui';
import s from './AvatarEditor.module.css';

type TabId = 'skin' | 'hair' | 'face' | 'beard' | 'hat' | 'eyewear' | 'top' | 'bottom' | 'feet' | 'held' | 'back' | 'pet' | 'bg';
type Section =
  | { kind: 'swatch'; key: 'skin' | 'hairColor' | 'bgColor'; title: TKey }
  | { kind: 'base'; key: AvatarBaseKey; title?: TKey }
  | { kind: 'slot'; slot: ItemSlot; title?: TKey };

const TABS: { id: TabId; color: string; sections: Section[] }[] = [
  { id: 'skin', color: '#ff7a1a', sections: [{ kind: 'swatch', key: 'skin', title: 'avatar.section.skin' }] },
  {
    id: 'hair',
    color: '#ffd21f',
    sections: [
      { kind: 'base', key: 'hair', title: 'avatar.section.hairStyle' },
      { kind: 'swatch', key: 'hairColor', title: 'avatar.section.hairColor' },
      { kind: 'slot', slot: 'hair', title: 'avatar.section.hairAcc' },
    ],
  },
  {
    id: 'face',
    color: '#00b3c7',
    sections: [
      { kind: 'base', key: 'eyes', title: 'avatar.section.eyes' },
      { kind: 'base', key: 'brows', title: 'avatar.section.brows' },
      { kind: 'base', key: 'mouth', title: 'avatar.section.mouth' },
    ],
  },
  { id: 'beard', color: '#8cd62c', sections: [{ kind: 'base', key: 'facialHair' }] },
  { id: 'hat', color: '#e8303a', sections: [{ kind: 'slot', slot: 'hat' }] },
  { id: 'eyewear', color: '#7a3ff2', sections: [{ kind: 'slot', slot: 'face' }] },
  { id: 'top', color: '#1e88e5', sections: [{ kind: 'slot', slot: 'top' }] },
  { id: 'bottom', color: '#2f7fa8', sections: [{ kind: 'slot', slot: 'bottom' }] },
  { id: 'feet', color: '#ff7a1a', sections: [{ kind: 'slot', slot: 'feet' }] },
  { id: 'held', color: '#22b14c', sections: [{ kind: 'slot', slot: 'held' }] },
  { id: 'back', color: '#e8303a', sections: [{ kind: 'slot', slot: 'back' }] },
  { id: 'pet', color: '#ffd21f', sections: [{ kind: 'slot', slot: 'pet' }] },
  {
    id: 'bg',
    color: '#00b3c7',
    sections: [
      { kind: 'swatch', key: 'bgColor', title: 'avatar.section.bgColor' },
      { kind: 'slot', slot: 'background', title: 'avatar.section.bgItems' },
    ],
  },
];

const TAB_ICON_ITEM: Partial<Record<TabId, string>> = {
  hat: 'winged-helmet',
  eyewear: 'round-glasses',
  top: 'striped-tunic',
  bottom: 'brown-trousers',
  feet: 'leather-boots',
  held: 'wooden-sword',
  back: 'red-cape',
  pet: 'puppy',
  bg: 'meadow',
};

export const RARITY_COLOR: Record<Rarity, string> = { common: '#22b14c', rare: '#1e88e5', epic: '#7a3ff2', legendary: '#ffd21f' };
const RARITY_ORDER: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

function sameAvatar(a: AvatarData, b: AvatarData): boolean {
  const norm = (x: AvatarData) => JSON.stringify({ base: resolveBase(x), worn: Object.fromEntries(Object.entries(x.worn).filter(([, v]) => v).sort()) });
  return norm(a) === norm(b);
}

export default function AvatarEditorScreen() {
  const t = useT();
  const st = usePlayerState();
  const layout = useLayout();
  const tablet = layout === 'tablet';
  const search = useSearch();
  const askName = new URLSearchParams(search).get('from') === 'invite' || !st.profile.nameChosen;

  const saved = st.profile.avatar;
  const [draft, setDraft] = useState<AvatarData>(() => ({ v: AVATAR_VERSION, base: { ...resolveBase(saved) }, worn: { ...saved.worn } }));
  const [tab, setTab] = useState<TabId>('hair');
  const [bump, setBump] = useState(0);
  const [focus, setFocus] = useState<{ item: Item; locked: boolean } | null>(null);
  const [name, setName] = useState(st.profile.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const owned = useMemo(() => new Set([...Object.keys(st.inventory), ...STARTER_ITEM_IDS]), [st.inventory]);
  const base = resolveBase(draft);
  const nameCheck = checkName(name.trim());
  const nameChanged = askName && name.trim() !== st.profile.name;
  const dirty = !sameAvatar(draft, saved) || (nameChanged && nameCheck.ok) || (askName && !st.profile.nameChosen && nameCheck.ok);

  const change = (next: AvatarData) => {
    setDraft(next);
    setBump((n) => n + 1);
    fx.sfx('pop');
  };
  const setBase = (key: AvatarBaseKey, value: string) => change({ ...draft, base: { ...draft.base, [key]: value } });
  const wear = (slot: ItemSlot, item: Item | null) => {
    if (item && !owned.has(item.id)) {
      setFocus({ item, locked: true });
      fx.sfx('wrong');
      return;
    }
    const worn = { ...draft.worn };
    if (item) worn[slot] = item.id;
    else delete worn[slot];
    change({ ...draft, worn });
    setFocus(item ? { item, locked: false } : null);
  };
  const surprise = () => {
    change(randomAvatar(`${Date.now()}`, [...owned]));
    setFocus(null);
    fx.sfx('whoosh');
  };

  const save = async () => {
    const problems = validateAvatar(draft, [...owned]);
    if (problems.length) {
      toast(t('common.error.avatar-invalid'));
      return;
    }
    const req: { avatar: AvatarData; name?: string } = { avatar: draft };
    if (askName && nameCheck.ok && (nameChanged || !st.profile.nameChosen)) req.name = name.trim();
    setSaving(true);
    setNameError(null);
    try {
      const res = await api.patchMe(req);
      usePlayer.getState().apply(res.patch);
      fx.sfx('win');
      fx.confetti();
      toast(t('avatar.saved'));
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : 'internal';
      if (code === 'name-taken' || code === 'name-rude' || code === 'name-invalid') setNameError(t(`common.error.${code}` as TKey));
      else actionFailed(e);
    } finally {
      setSaving(false);
    }
  };

  const current = TABS.find((x) => x.id === tab)!;
  const rank = xpRank(st.currencies.xp);
  const wide = useWide();
  const previewSize = tablet ? (wide ? 300 : 240) : 168;

  const howToGet = (item: Item): string => {
    const src = item.sources[0];
    if (!src) return '';
    switch (src.kind) {
      case 'starter':
        return t('avatar.get.starter');
      case 'chest':
        return item.price !== null ? `${t('avatar.get.chest')} ${t('avatar.get.shop', { n: item.price })}` : t('avatar.get.chest');
      case 'shop':
        return t('avatar.get.shop', { n: item.price ?? 0 });
      case 'achievement': {
        const a = ACHIEVEMENTS_BY_ID.get(src.achievementId);
        return t('avatar.get.achievement', { name: a ? a.name[st.profile.language] : src.achievementId });
      }
      case 'gift':
        return t('avatar.get.gift');
    }
  };

  const lang = st.profile.language;
  const balloon = focus && (
    <Balloon className={s.balloon} tail={tablet && wide ? 'left' : 'top'} tailAt="30%" color={focus.locked ? 'yellow' : 'white'} key={focus.item.id + String(focus.locked)}>
      <div className={s.balloonHead}>
        <strong>{focus.item.name[lang]}</strong>
        <span className={s.rarity} style={{ '--r': RARITY_COLOR[focus.item.rarity] } as CSSProperties}>
          {t(`chest.rarity.${focus.item.rarity}` as const)}
        </span>
      </div>
      <p className={s.joke}>{focus.item.joke[lang]}</p>
      {focus.locked && (
        <p className={s.how}>
          <b>{t('avatar.locked')}</b> {howToGet(focus.item)}
        </p>
      )}
    </Balloon>
  );

  const cover = (
    <section className={s.cover} aria-label={t('avatar.title')}>
      <header className={s.coverHead}>
        <span className={s.coverSmall}>{t('avatar.cover')}</span>
        <span className={s.coverName}>{(askName ? name.trim() || st.profile.name : st.profile.name).toUpperCase()}</span>
      </header>
      <div className={s.coverArt}>
        <div key={bump} className={cx(s.preview, bump > 0 && s.slam)}>
          <Avatar avatar={draft} size={previewSize} framing="full" label={t('avatar.title')} />
        </div>
        <Stamp className={s.issue} variant="issue" color="yellow" tilt={-8}>
          {t('avatar.issue', { n: rank })}
        </Stamp>
      </div>
      {!sameAvatar(draft, saved) && <span className={s.unsaved}>{t('avatar.unsaved')}</span>}
    </section>
  );

  const nameField = askName && (
    <section className={s.namePanel}>
      <label className={s.nameLabel} htmlFor="avatar-name">
        {t('avatar.name.label')}
      </label>
      <div className={s.nameRow}>
        <input
          id="avatar-name"
          className={cx(s.nameInput, !nameCheck.ok && name.length > 0 && s.nameBad)}
          value={name}
          maxLength={24}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        <Button
          color="yellow"
          icon="star"
          aria-label={t('avatar.name.roll')}
          title={t('avatar.name.roll')}
          onClick={() => {
            setName(randomName());
            setNameError(null);
            fx.sfx('pop');
          }}
        />
      </div>
      <p className={cx(s.nameHint, (nameError || !nameCheck.ok) && s.nameHintBad)} aria-live="polite">
        {nameError ?? (nameCheck.ok ? t('avatar.name.ok') : t(`avatar.name.${nameCheck.reason}` as TKey))}
      </p>
    </section>
  );

  const tabs = (
    <nav className={s.tabs} aria-label={t('avatar.title')}>
      {TABS.map((x) => (
        <button
          key={x.id}
          type="button"
          className={cx(s.tab, tab === x.id && s.tabOn)}
          style={{ '--tab': x.color } as CSSProperties}
          aria-pressed={tab === x.id}
          aria-label={t(`avatar.tab.${x.id}` as TKey)}
          title={t(`avatar.tab.${x.id}` as TKey)}
          onClick={() => {
            setTab(x.id);
            setFocus(null);
            fx.sfx('tap');
          }}
        >
          <TabIcon id={x.id} draft={draft} />
        </button>
      ))}
    </nav>
  );

  const options = (
    <div className={s.options} style={{ '--tab': current.color } as CSSProperties}>
      <h2 className={s.caption}>{t(`avatar.tab.${current.id}` as TKey)}</h2>
      {current.sections.map((sec, i) => (
        <div key={i} className={s.section}>
          {sec.title && current.sections.length > 1 && <h3 className={s.subcaption}>{t(sec.title)}</h3>}
          {sec.kind === 'swatch' && (
            <div className={s.swatches}>
              {(AVATAR_BASE_OPTIONS[sec.key] as readonly string[]).map((v) => {
                const color = (sec.key === 'skin' ? SKIN : sec.key === 'hairColor' ? HAIR : BG)[v as never] as string;
                return (
                  <button
                    key={v}
                    type="button"
                    className={cx(s.swatch, base[sec.key] === v && s.on)}
                    style={{ '--sw': color } as CSSProperties}
                    aria-pressed={base[sec.key] === v}
                    aria-label={`${t(sec.title)} ${v}`}
                    onClick={() => setBase(sec.key, v)}
                  />
                );
              })}
            </div>
          )}
          {sec.kind === 'base' && (
            <div className={s.grid}>
              {(AVATAR_BASE_OPTIONS[sec.key] as readonly string[]).map((v) => (
                <button key={v} type="button" className={cx(s.tile, base[sec.key] === v && s.on)} aria-pressed={base[sec.key] === v} aria-label={v} onClick={() => setBase(sec.key, v)}>
                  <Avatar avatar={{ ...draft, base: { ...draft.base, [sec.key]: v }, worn: { top: draft.worn.top } }} size={tablet ? 76 : 66} framing="bust" shape="none" animate={false} />
                </button>
              ))}
            </div>
          )}
          {sec.kind === 'slot' && (
            <div className={s.grid}>
              <button type="button" className={cx(s.tile, s.noneTile, !draft.worn[sec.slot] && s.on)} aria-pressed={!draft.worn[sec.slot]} onClick={() => wear(sec.slot, null)}>
                <span>{t('avatar.none')}</span>
              </button>
              {slotItems(sec.slot, owned).map((item) => {
                const has = owned.has(item.id);
                const on = draft.worn[sec.slot] === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cx(s.tile, on && s.on, !has && s.locked)}
                    aria-pressed={on}
                    aria-label={item.name[lang] + (has ? '' : ` (${t('avatar.locked')})`)}
                    onClick={() => wear(sec.slot, item)}
                  >
                    <ItemIcon itemId={item.id} size={tablet ? 64 : 56} silhouette={!has} />
                    <span className={s.corner} style={{ '--r': RARITY_COLOR[item.rarity] } as CSSProperties} />
                    {!has && <span className={s.q}>?</span>}
                    {!has && item.price !== null && <span className={s.tag}>{item.price}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const actions = (
    <div className={s.actions}>
      <Button color="purple" icon="star" onClick={surprise}>
        {t('avatar.surprise')}
      </Button>
      <Button color="green" icon="check" size="lg" onClick={save} disabled={!dirty || saving || (askName && !nameCheck.ok)} loading={saving}>
        {t('avatar.save')}
      </Button>
    </div>
  );

  if (tablet && !wide) {
    return (
      <div className={s.pagePortrait}>
        <div className={s.portraitTop}>
          {cover}
          <div className={s.portraitSide}>
            {nameField}
            {balloon}
            {actions}
          </div>
        </div>
        {tabs}
        {options}
      </div>
    );
  }
  if (tablet) {
    return (
      <div className={s.pageTablet}>
        <div className={s.left}>
          {cover}
          {nameField}
          {actions}
        </div>
        <div className={s.right}>
          {tabs}
          {balloon}
          {options}
        </div>
      </div>
    );
  }
  return (
    <div className={s.pagePhone}>
      <div className={s.phoneTop}>
        {cover}
        {balloon}
      </div>
      {nameField}
      {tabs}
      {options}
      <div className={s.phoneActions}>{actions}</div>
    </div>
  );
}

/** True when the window is wide enough for the cover and the options side by side. */
function useWide(): boolean {
  const query = '(min-width: 900px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** A slot's items: owned first, then by rarity. */
function slotItems(slot: ItemSlot, owned: ReadonlySet<string>): Item[] {
  return ITEMS.filter((i) => i.slot === slot).sort((a, b) => Number(owned.has(b.id)) - Number(owned.has(a.id)) || RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]);
}

function TabIcon({ id, draft }: { id: TabId; draft: AvatarData }): ReactNode {
  const itemId = TAB_ICON_ITEM[id];
  if (itemId) return <ItemIcon itemId={itemId} size={36} />;
  const b = resolveBase(draft);
  if (id === 'skin') return <span className={s.tabSwatch} style={{ background: SKIN[b.skin] }} />;
  const variant: AvatarData =
    id === 'beard'
      ? { ...draft, base: { ...draft.base, facialHair: b.facialHair === 'none' ? 'walrus' : b.facialHair }, worn: {} }
      : id === 'face'
        ? { ...draft, base: { ...draft.base, hair: 'bald', facialHair: 'none' }, worn: {} }
        : { ...draft, worn: {} };
  return <Avatar avatar={variant} size={40} framing="bust" shape="none" animate={false} />;
}
