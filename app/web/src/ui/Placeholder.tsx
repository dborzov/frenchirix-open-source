import type { ReactNode } from 'react';
import { t, type TKey } from '../../../shared/i18n';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import type { BlockColor } from './colors';
import type { IconName } from './icons';
import s from './Placeholder.module.css';

/** The stand-in for a screen a later step builds. Remove it when the screen is built. */
export function Placeholder({ title, owner, icon = 'star', color = 'yellow', children }: { title: TKey; owner: string; icon?: IconName; color?: BlockColor; children?: ReactNode }) {
  return (
    <section className={s.wrap} data-placeholder={owner}>
      <h1 className={s.title}>{t(title)}</h1>
      <Card>
        <EmptyState icon={icon} color={color} title={t('common.notBuilt')} text={t('common.notBuiltHint')} />
        <p className={s.meta}>{owner}</p>
      </Card>
      {children}
    </section>
  );
}
