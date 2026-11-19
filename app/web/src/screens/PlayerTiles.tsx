// The accounts this device remembers as tiles (avatar and name), for the player selection (/players)
// and the "Played before?" welcome (pwa/Overlay.tsx). Tap a tile to play as that account.
import type { CSSProperties } from 'react';
import { t } from '../../../shared/i18n';
import { Avatar } from '../avatar/Avatar';
import type { RememberedAccount } from '../state/accounts';
import { cx, IconButton, Spinner } from '../ui';
import s from './PlayerTiles.module.css';

export interface PlayerTilesProps {
  accounts: RememberedAccount[];
  /** The account playing now: marked, and never offered for removal. */
  currentId?: string;
  /** The account being opened (a spinner on it; the other tiles wait). */
  busyId?: string | null;
  onPick: (a: RememberedAccount) => void;
  /** Without it, no remove buttons. */
  onRemove?: (a: RememberedAccount) => void;
  avatarSize: number;
  className?: string;
}

export function PlayerTiles({ accounts, currentId, busyId, onPick, onRemove, avatarSize, className }: PlayerTilesProps) {
  return (
    <ul className={cx(s.grid, className)} style={{ '--tile': `${avatarSize + 40}px` } as CSSProperties}>
      {accounts.map((a, i) => {
        const current = a.id === currentId;
        return (
          <li key={a.id} className={s.cell} style={{ '--tilt': `${[-1.2, 0.8, -0.4, 1.1, -0.9, 0.5][i % 6]}deg` } as CSSProperties}>
            <button
              type="button"
              className={cx(s.tile, current && s.current)}
              onClick={() => onPick(a)}
              disabled={!!busyId}
              aria-label={current ? `${a.name} (${t('players.current')})` : t('players.playAs', { name: a.name })}
              data-player={a.name}
              data-current={current || undefined}
            >
              <Avatar avatar={a.avatar} size={avatarSize} framing="bust" />
              <span className={s.name}>{a.name}</span>
              {current && <span className={s.now}>{t('players.current')}</span>}
              {busyId === a.id && (
                <span className={s.busy}>
                  <Spinner />
                </span>
              )}
            </button>
            {onRemove && !current && (
              <IconButton icon="close" size="sm" label={t('players.removeLabel', { name: a.name })} className={s.remove} onClick={() => onRemove(a)} disabled={!!busyId} data-player-remove={a.name} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
