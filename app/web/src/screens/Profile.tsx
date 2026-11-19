// Route /profile: avatar, name, secret number, settings, statistics, and "Switch player" (the player
// selection, /players, for several kids sharing one device).
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { Language } from '../../../shared/api';
import { t } from '../../../shared/i18n';
import { xpForRank, xpRank, type Level } from '../../../shared/rules';
import { api, ApiRequestError } from '../api';
import { Avatar } from '../avatar/Avatar';
import { fx } from '../fx';
import { checkName, type NameCheck } from '../home/checkName';
import { Caption, CoverTag } from '../home/comic';
import { errorText } from '../home/hooks';
import { levelsAtLeast } from '../home/logic';
import { ScreenTitle } from '../home/parts';
import { InstallButton } from '../pwa';
import { ReportButton } from '../report';
import { usePlayer, usePlayerState } from '../state/player';
import { actionFailed } from '../state/recover';
import { Badge, Button, cx, Icon, ProgressBar, toast, useLayout, type IconName } from '../ui';
import s from './Profile.module.css';

export default function ProfileScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const tablet = layout === 'tablet';
  const [, navigate] = useLocation();
  const rank = xpRank(st.currencies.xp);
  const from = xpForRank(rank);
  const to = xpForRank(rank + 1);

  const hero = (
    <section className={cx(s.panel, s.hero)}>
      <CoverTag className={s.rankTag} color="yellow" tilt={6}>
        {t('profile.rank', { n: rank })}
      </CoverTag>
      <button type="button" className={s.avatar} onClick={() => navigate('/avatar')} aria-label={t('profile.editAvatar')}>
        <Avatar avatar={st.profile.avatar} size={tablet ? 150 : 120} />
        <span className={s.avatarEdit}>
          <Icon name="gear" size={18} /> {t('profile.editAvatar')}
        </span>
      </button>
      <NameEditor name={st.profile.name} />
      <div className={s.xp}>
        <ProgressBar value={st.currencies.xp - from} max={to - from} color="green" height={20} label={`${st.currencies.xp - from} / ${to - from} XP`} />
        <span className={s.xpNext}>{t('profile.toNext', { n: to - st.currencies.xp, rank: rank + 1 })}</span>
      </div>
    </section>
  );

  const secret = (
    <section className={cx(s.panel, s.secret)}>
      <Caption as="h2">{t('profile.pin')}</Caption>
      <div className={s.pin} aria-label={`${t('profile.pin')}: ${st.profile.pin.split('').join(' ')}`}>
        {st.profile.pin.split('').map((d, i) => (
          <span key={i} className={s.digit} style={{ '--i': i } as CSSProperties}>
            {d}
          </span>
        ))}
      </div>
      <p className={s.pinWhy}>{t('profile.pinWhy')}</p>
    </section>
  );

  const settings = (
    <section className={cx(s.panel, s.settings)}>
      <Caption as="h2" color="cyan">
        {t('profile.settings')}
      </Caption>
      <Setting icon="speaker" label={t('common.language')}>
        <Toggle<Language>
          value={st.profile.language}
          options={[
            ['fr', t('common.language.fr')],
            ['en', t('common.language.en')],
          ]}
          onChange={(lang) => usePlayer.getState().setLanguage(lang).catch(actionFailed)}
        />
      </Setting>
      <Setting icon="mic" label={t('profile.speakLabel')} hint={t('profile.speakHint')}>
        <Toggle<boolean>
          value={st.profile.speak}
          options={[
            [true, t('profile.speakYes')],
            [false, t('profile.speakNo')],
          ]}
          onChange={async (speak) => {
            try {
              const res = await api.patchMe({ speak });
              usePlayer.getState().apply(res.patch);
            } catch (e) {
              actionFailed(e);
            }
          }}
        />
      </Setting>
    </section>
  );

  const atLeast = levelsAtLeast(st.progress);
  const stats = (
    <section className={cx(s.panel, s.stats)}>
      <Caption as="h2" color="orange">
        {t('profile.stats')}
      </Caption>
      <div className={s.statGrid}>
        <Stat icon="unlock" n={Object.keys(st.progress).length} label={t('profile.stat.unlocked')} color="blue" />
        <Stat icon="flame" n={st.streak.best} label={t('profile.stat.bestStreak')} color="tomato" />
        <Stat icon="mic" n={st.stats.linesSpoken ?? 0} label={t('profile.stat.spoken')} color="green" />
        <Stat icon="karaoke" n={st.stats.songsSung ?? 0} label={t('profile.stat.sung')} color="purple" />
        <Stat icon="check" n={st.stats.practicesFinished ?? 0} label={t('profile.stat.practices')} color="yellow" />
        <Stat icon="loop" n={st.stats.loopsHeard ?? 0} label={t('profile.stat.loops')} color="cyan" />
      </div>
      <div className={s.levelRow}>
        {([1, 2, 3, 4, 5, 6] as Level[]).map((m) => (
          <span key={m} className={cx(s.levelCell, atLeast[m] === 0 && s.levelNone)}>
            <Badge level={m} size={30} />
            <span className={s.levelN}>{atLeast[m]}</span>
          </span>
        ))}
      </div>
      <p className={s.levelNote}>{t('profile.levelsNote')}</p>
    </section>
  );

  const links = (
    <section className={s.links}>
      <Button color="yellow" icon="trophy" onClick={() => navigate('/achievements')}>
        {t('nav.achievements')}
      </Button>
      <Button color="white" icon="star" size="sm" onClick={() => navigate('/version')}>
        {t('version.title')}
      </Button>
      <InstallButton />
      <ReportButton />
    </section>
  );

  return (
    <div className={cx(s.page, tablet && s.tablet)}>
      <ScreenTitle
        icon="profile"
        color="purple"
        right={
          <Button color="accent-2" size="sm" icon="friends" onClick={() => navigate('/players')} className={s.switch} data-switch-player>
            {t('profile.switch')}
          </Button>
        }
      >
        {t('profile.title')}
      </ScreenTitle>
      {tablet ? (
        <div className={s.columns}>
          <div className={s.col}>
            {hero}
            {secret}
            {links}
          </div>
          <div className={s.col}>
            {settings}
            {stats}
          </div>
        </div>
      ) : (
        <>
          {hero}
          {secret}
          {settings}
          {stats}
          {links}
        </>
      )}
    </div>
  );
}

function nameProblem(c: NameCheck): string | null {
  if (c.ok) return null;
  if (c.reason === 'rude') return t('common.error.name-rude');
  if (c.reason === 'chars') return t('profile.name.chars');
  return t('profile.name.length');
}

function NameEditor({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ text: string; code: string } | null>(null);
  const check = checkName(value);
  const problem = value.trim() === name ? null : nameProblem(check);
  const save = async () => {
    if (!check.ok || value.trim() === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const res = await api.patchMe({ name: value.trim() });
      usePlayer.getState().apply(res.patch);
      fx.sfx('right');
      toast(t('profile.name.saved'), { color: 'green', icon: 'check' });
      setEditing(false);
    } catch (e) {
      // A refused name is said under the field; anything else as for any failed action.
      if (e instanceof ApiRequestError && e.code.startsWith('name-')) setServerError({ text: errorText(e), code: e.code });
      else actionFailed(e);
    } finally {
      setBusy(false);
    }
  };
  if (!editing) {
    return (
      <div className={s.nameRow}>
        <h2 className={s.name}>{name}</h2>
        <Button size="sm" color="white" icon="gear" onClick={() => { setValue(name); setEditing(true); }} data-name-change>
          {t('profile.name.change')}
        </Button>
      </div>
    );
  }
  const msg = serverError?.text ?? problem;
  // What is wrong, for tests: the server's code (name-taken...) or the name check's reason (rude...).
  const msgCode = serverError?.code ?? (problem && !check.ok ? check.reason : undefined);
  return (
    <form className={s.nameForm} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className={s.fieldLabel} htmlFor="profile-name">
        {t('profile.name.label')}
      </label>
      <input
        id="profile-name"
        className={cx(s.input, msg && s.inputBad, !msg && value.trim() !== name && check.ok && s.inputOk)}
        value={value}
        onChange={(e) => { setValue(e.target.value); setServerError(null); }}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={24}
        autoFocus
      />
      <p className={cx(s.feedback, msg ? s.feedbackBad : s.feedbackOk)} aria-live="polite" data-name-problem={msgCode}>
        {msg ?? (value.trim() !== name && check.ok ? t('profile.name.ok') : t('profile.name.rules'))}
      </p>
      <div className={s.formButtons}>
        <Button type="button" size="sm" color="white" onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" color="green" icon="check" loading={busy} disabled={!!problem} data-name-save>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function Setting({ icon, label, hint, children }: { icon: IconName; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={s.setting}>
      <div className={s.settingHead}>
        <span className={s.settingIcon}>
          <Icon name={icon} size={22} />
        </span>
        <span className={s.settingLabel}>{label}</span>
      </div>
      {hint && <p className={s.settingHint}>{hint}</p>}
      {children}
    </div>
  );
}

function Toggle<T extends string | boolean>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className={s.toggle} role="radiogroup">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={cx(s.toggleOpt, value === v && s.toggleOn)} onClick={() => value !== v && onChange(v)} data-option={String(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Stat({ icon, n, label, color }: { icon: IconName; n: number; label: string; color: string }) {
  return (
    <div className={s.stat} style={{ '--c': `var(--${color})` } as CSSProperties}>
      <span className={s.statIcon}>
        <Icon name={icon} size={22} />
      </span>
      <span className={s.statN}>{n}</span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}
