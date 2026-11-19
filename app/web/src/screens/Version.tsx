// OWNER: the version page (meta agent). Route /version: version updates, newest first, each with patch notes.
import type { CSSProperties } from 'react';
import data from '../../../data/versions.json';
import { getLanguage, t } from '../../../shared/i18n';
import { CoverTag } from '../home/comic';
import { ScreenTitle } from '../home/parts';
import { BuildStamp } from '../pwa';
import { cx, useLayout } from '../ui';
import s from './Version.module.css';

export interface VersionEntry {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
}

/** Newest first, by date then version. */
export function sortedVersions(list: VersionEntry[]): VersionEntry[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

function formatDate(day: string): string {
  try {
    return new Intl.DateTimeFormat(getLanguage() === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  } catch {
    return day;
  }
}

export default function VersionScreen() {
  const layout = useLayout();
  const versions = sortedVersions((data as { versions: VersionEntry[] }).versions);
  return (
    <div className={cx(s.page, layout === 'tablet' && s.tablet)}>
      <ScreenTitle icon="star" color="tomato">
        {t('version.title')}
      </ScreenTitle>
      <ol className={s.list}>
        {versions.map((v, i) => (
          <li key={v.version} className={cx(s.entry, i === 0 && s.latest)} style={{ '--i': i } as CSSProperties} data-version={v.version}>
            <div className={s.head}>
              <CoverTag color={i === 0 ? 'yellow' : 'white'} tilt={-4}>
                {t('version.v', { v: v.version })}
              </CoverTag>
              <span className={s.date}>{formatDate(v.date)}</span>
              {i === 0 && <span className={s.new}>{t('version.latest')}</span>}
            </div>
            <h2 className={s.title}>{v.title}</h2>
            <ul className={s.notes}>
              {v.notes.map((n, k) => (
                <li key={k}>{n}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <BuildStamp />
    </div>
  );
}
