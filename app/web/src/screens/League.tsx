// OWNER: the league step (meta agent). Route /league: this week's table, promotion and relegation zones, the five tiers.
import type { CSSProperties } from 'react';
import { t } from '../../../shared/i18n';
import { daysBetween, LEAGUE_TIERS, type LeagueTier } from '../../../shared/rules';
import { api } from '../api';
import { Avatar } from '../avatar/Avatar';
import { Caption, CoverTag } from '../home/comic';
import { useAsync } from '../home/hooks';
import { Loading, LoadError, ScreenTitle } from '../home/parts';
import { usePlayerState } from '../state/player';
import { cx, Icon, useLayout } from '../ui';
import s from './League.module.css';

const TIER_COLORS = ['orange', 'tomato', 'cyan', 'yellow', 'purple'];

export function TierShield({ tier, size = 56, dim = false }: { tier: LeagueTier; size?: number; dim?: boolean }) {
  return (
    <svg viewBox="0 0 48 56" width={size} height={(size * 56) / 48} className={cx(s.shield, dim && s.shieldDim)} aria-hidden>
      <path d="M7 7h38v20c0 14-9 22-19 27C16 49 7 41 7 27z" fill="var(--ink)" />
      <path d="M4 4h38v20c0 14-9 22-19 27C13 46 4 38 4 24z" fill={`var(--${TIER_COLORS[tier]}, var(--yellow))`} stroke="var(--ink)" strokeWidth="3.5" />
      <text x="23" y="34" textAnchor="middle" fontFamily="var(--font-display)" fontSize="22" fill="var(--white)" stroke="var(--ink)" strokeWidth="1.5" paintOrder="stroke">
        {tier + 1}
      </text>
    </svg>
  );
}

export default function LeagueScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const tablet = layout === 'tablet';
  const league = useAsync(() => api.league());
  if (league.error) return <LoadError error={league.error} onRetry={league.reload} />;
  if (!league.data) return <Loading />;
  const L = league.data;
  const daysLeft = Math.max(0, daysBetween(st.today, L.endsDay)) + 1;
  const n = L.rows.length;
  const tierName = (k: number) => t(`league.tier.${LEAGUE_TIERS[k]!}` as const);

  const ladder = (
    <div className={s.ladder}>
      {[4, 3, 2, 1, 0].map((k) => (
        <div key={k} className={cx(s.rung, k === L.tier && s.rungMe)}>
          <TierShield tier={k as LeagueTier} size={k === L.tier ? 48 : 34} dim={k > L.tier} />
          <span className={s.rungName}>{tierName(k)}</span>
          {k === L.tier && <span className={s.youHere}>{t('league.youHere')}</span>}
        </div>
      ))}
    </div>
  );

  const table = (
    <div className={s.table}>
      {L.rows.map((r, i) => {
        const up = L.promote > 0 && r.rank <= L.promote;
        const down = L.demote > 0 && r.rank > n - L.demote;
        return (
          <div key={r.userId}>
            {L.promote > 0 && r.rank === L.promote + 1 && <div className={cx(s.zoneLine, s.zoneUp)}>{t('league.promoteLine')}</div>}
            {L.demote > 0 && r.rank === n - L.demote + 1 && <div className={cx(s.zoneLine, s.zoneDown)}>{t('league.demoteLine')}</div>}
            <div className={cx(s.row, up && s.up, down && s.down, r.me && s.me)} style={{ '--i': i } as CSSProperties} data-me={r.me || undefined}>
              <span className={s.rank}>{r.rank}</span>
              <span className={s.rowAvatar}>
                <Avatar avatar={r.avatar} size={40} />
              </span>
              <span className={s.rowName}>{r.me ? t('league.me', { name: r.name }) : r.name}</span>
              <span className={s.rowXp}>{t('common.xp', { n: r.weekXp })}</span>
              {up && <Icon name="forward" size={20} className={s.arrowUp} />}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={cx(s.page, tablet && s.tablet)}>
      <ScreenTitle icon="league" color="blue" right={<CoverTag color="yellow">{t('league.daysLeft', { n: daysLeft })}</CoverTag>}>
        {t('league.title')}
      </ScreenTitle>
      <div className={s.banner}>
        <TierShield tier={L.tier} size={tablet ? 90 : 72} />
        <div className={s.bannerText}>
          <span className={s.tierName} data-tier={LEAGUE_TIERS[L.tier]}>{tierName(L.tier)}</span>
          <span className={s.bannerSub}>{L.promote > 0 ? t('league.goal', { n: L.promote }) : t('league.top')}</span>
        </div>
      </div>
      {tablet ? (
        <div className={s.columns}>
          <div>{table}</div>
          <aside>
            <Caption as="h2">{t('league.tiers')}</Caption>
            <div className={s.gap} />
            {ladder}
            <p className={s.how}>{t('league.how')}</p>
          </aside>
        </div>
      ) : (
        <>
          {table}
          <div className={s.gap} />
          <Caption as="h2">{t('league.tiers')}</Caption>
          <div className={s.gap} />
          {ladder}
          <p className={s.how}>{t('league.how')}</p>
        </>
      )}
    </div>
  );
}
