import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { t } from '../../../shared/i18n';
import type { TKey } from '../../../shared/i18n';
import { cx, type Section } from './colors';
import { Icon, type IconName } from './icons';
import { DruidMark } from '../pwa/DruidMark';
import { Logo } from './Logo';
import { useLayout } from './useLayout';
import s from './AppShell.module.css';

interface NavItem {
  href: string;
  icon: IconName;
  label: TKey;
  color: string; // the section whose colour the active tab takes
  phone: boolean; // shown in the phone tab bar (five at most); every item shows in the tablet rail
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', icon: 'home', label: 'nav.home', color: 'home', phone: true },
  { href: '/episodes', icon: 'episodes', label: 'nav.episodes', color: 'episodes', phone: true },
  { href: '/karaoke', icon: 'karaoke', label: 'nav.karaoke', color: 'karaoke', phone: true },
  { href: '/friends', icon: 'friends', label: 'nav.friends', color: 'friends', phone: true },
  { href: '/league', icon: 'league', label: 'nav.league', color: 'league', phone: false },
  { href: '/shop', icon: 'shop', label: 'nav.shop', color: 'shop', phone: false },
  { href: '/achievements', icon: 'trophy', label: 'nav.achievements', color: 'achievements', phone: false },
  { href: '/profile', icon: 'profile', label: 'nav.profile', color: 'profile', phone: true },
];

/** Sections whose colour is dark enough for white lettering. */
const DARK_SECTIONS: ReadonlySet<string> = new Set(['episodes', 'karaoke', 'league', 'shop', 'practice', 'friends']);

const SECTION_BY_PREFIX: [string, Section][] = [
  ['/unlock', 'unlock'],
  ['/practice', 'practice'],
  ['/episodes', 'episodes'],
  ['/scene', 'episodes'],
  ['/karaoke', 'karaoke'],
  ['/friends', 'friends'],
  ['/league', 'league'],
  ['/shop', 'shop'],
  ['/chest', 'chest'],
  ['/profile', 'profile'],
  ['/avatar', 'avatar'],
  ['/achievements', 'achievements'],
  ['/login', 'login'],
  ['/players', 'login'],
  ['/version', 'version'],
  ['/dev/practice', 'practice'],
  ['/dev/scene', 'episodes'],
  ['/dev/avatar', 'avatar'],
];

/** The section (page colour) of a route path. */
export function sectionForPath(path: string): Section {
  for (const [prefix, section] of SECTION_BY_PREFIX) if (path === prefix || path.startsWith(`${prefix}/`)) return section;
  return 'home';
}

function sectionVars(section: string): CSSProperties {
  const dark = DARK_SECTIONS.has(section);
  return {
    '--c': `var(--section-${section})`,
    '--c-text': dark ? 'var(--white)' : 'var(--ink)',
    '--c-stroke': dark ? 'var(--ink)' : 'transparent',
  } as CSSProperties;
}

function isActive(href: string, path: string): boolean {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

function NavLink({ item, path }: { item: NavItem; path: string }) {
  const active = isActive(item.href, path);
  return (
    <Link
      href={item.href}
      className={s.tab}
      aria-current={active ? 'page' : undefined}
      style={sectionVars(item.color)}
      data-nav={item.href}
    >
      <span className={s.tabIcon}>
        <Icon name={item.icon} size={26} />
      </span>
      <span className={s.tabLabel}>{t(item.label)}</span>
    </Link>
  );
}

export interface AppShellProps {
  /** The streak and currency counters, shown in the top bar. */
  counters?: ReactNode;
  /** Hide navigation (full-screen moments such as a practice). */
  bare?: boolean;
  /** The page colour; by default the current route's section (sectionForPath). */
  section?: Section;
  children: ReactNode;
}

/** The frame of every screen: bottom tab bar on phone, side rail on tablet, counters at the top. */
export function AppShell({ counters, bare = false, section, children }: AppShellProps) {
  const layout = useLayout();
  const [path] = useLocation();
  const sec = section ?? sectionForPath(path);
  const pageStyle = { '--section': `var(--section-${sec})` } as CSSProperties;
  // The section's accents live on <html>, so modals, sheets and toasts (portals) follow them too.
  useEffect(() => {
    document.documentElement.dataset.section = sec;
  }, [sec]);
  if (bare) {
    return (
      <div className={cx(s.shell, s.bare)} data-layout={layout} data-section={sec} style={pageStyle}>
        <main className={s.main}>{children}</main>
      </div>
    );
  }
  const tablet = layout === 'tablet';
  return (
    <div className={cx(s.shell, tablet && s.withRail)} data-layout={layout} data-section={sec} style={pageStyle}>
      {tablet && (
        <nav className={s.rail} aria-label="Navigation">
          <Link href="/" className={s.railLogo} aria-label="Frenchirix">
            <DruidMark size={60} tile className={s.mark} />
            <Logo size={15} />
          </Link>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} path={path} />
          ))}
        </nav>
      )}
      <header className={s.topbar}>
        <div className={s.brand}>{tablet ? null : <><DruidMark size={40} tile className={s.mark} /><span className={s.wordmark}><Logo size={28} /></span></>}</div>
        <div className={s.counters}>{counters}</div>
      </header>
      <main className={s.main}>{children}</main>
      {!tablet && (
        <nav className={s.tabbar} aria-label="Navigation">
          {NAV_ITEMS.filter((i) => i.phone).map((item) => (
            <NavLink key={item.href} item={item} path={path} />
          ))}
        </nav>
      )}
    </div>
  );
}
