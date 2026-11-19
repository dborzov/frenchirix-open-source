// The streak and currency counters in the shell's top bar.
import { useLocation } from 'wouter';
import { t } from '../../shared/i18n';
import { MuteButton } from './audio/MuteButton';
import { Counter, useLayout } from './ui';
import { usePlayer } from './state/player';

export function ShellCounters() {
  const [, navigate] = useLocation();
  const layout = useLayout();
  const streak = usePlayer((s) => s.state?.streak);
  const cur = usePlayer((s) => s.state?.currencies);
  if (!streak || !cur) return null;
  const compact = layout === 'phone';
  return (
    <>
      <Counter icon="flame" value={streak.count} dim={!streak.doneToday} label={t('common.streak')} compact={compact} onClick={() => navigate('/')} />
      <Counter icon="coin" value={cur.sesterces} label={t('common.sesterces')} compact={compact} onClick={() => navigate('/shop')} />
      <Counter icon="potion" value={cur.potions} label={t('common.potions')} compact={compact} onClick={() => navigate('/shop')} />
      {layout === 'tablet' && <Counter icon="xp" value={cur.xp} label="XP" onClick={() => navigate('/league')} />}
      <MuteButton />
    </>
  );
}
