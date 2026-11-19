import type { ReactNode } from 'react';
import { burstPoints } from './Burst';
import { colorVars, type BlockColor } from './colors';
import { Icon, type IconName } from './icons';
import s from './EmptyState.module.css';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  text?: string;
  color?: BlockColor;
  action?: ReactNode; // usually a <Button>
}

/** A starburst with an icon, a tilted comic title and a line of text, for "nothing here yet". */
export function EmptyState({ icon, title, text, color = 'yellow', action }: EmptyStateProps) {
  return (
    <div className={s.empty}>
      <div className={s.art} style={colorVars(color)}>
        <svg className={s.shape} viewBox="0 0 100 100" aria-hidden style={{ filter: 'drop-shadow(5px 5px 0 var(--ink))' }}>
          <polygon points={burstPoints(12, 3, 0.26)} fill="var(--c)" stroke="var(--ink)" strokeWidth={3.5} strokeLinejoin="miter" />
        </svg>
        <Icon name={icon} size={54} className={s.icon} />
      </div>
      <h2 className={s.title}>{title}</h2>
      {text && <p className={s.text}>{text}</p>}
      {action}
    </div>
  );
}
