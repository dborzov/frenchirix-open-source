// Inline SVG icons. Line icons use currentColor; currency icons are full-colour.
// Usage: <Icon name="home" size={28} />. Add an icon by adding a path set to PATHS (24x24 grid, 2.5 stroke).
import type { CSSProperties, ReactElement } from 'react';

const line = (d: string | string[]) => (
  <g fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => (
      <path key={i} d={p} />
    ))}
  </g>
);

const PATHS = {
  home: line(['M3.5 11 12 4l8.5 7', 'M6 9.5V20h4.5v-5.5h3V20H18V9.5']),
  episodes: line(['M4 6.5h16v11H4z', 'M4 9.5h16', 'M4 14.5h16', 'M8 6.5v3', 'M12 6.5v3', 'M16 6.5v3', 'M8 14.5v3', 'M12 14.5v3', 'M16 14.5v3']),
  karaoke: line(['M9 3.5a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 1-7 0V7A3.5 3.5 0 0 1 9 3.5Z', 'M12.5 9.5l7 7.5-2 2-7.5-7', 'M9 14.5V20']),
  friends: line(['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5', 'M16 4.5a3 3 0 0 1 0 6', 'M18 14.5c1.9.6 3.1 2.4 3.5 5']),
  profile: line(['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 20.5c.8-4 4-6 8-6s7.2 2 8 6']),
  shop: line(['M5 8h14l-1 12H6L5 8Z', 'M9 8V6.5a3 3 0 0 1 6 0V8']),
  league: line(['M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3Z', 'm9 12 2 2 4-4']),
  trophy: line(['M7 4h10v5a5 5 0 0 1-10 0V4Z', 'M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11', 'M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5', 'M12 14v3.5', 'M8 20.5h8', 'M9.5 17.5h5v3h-5z']),
  lock: line(['M6 11h12v9.5H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3', 'M12 15v2']),
  unlock: line(['M6 11h12v9.5H6z', 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2', 'M12 15v2']),
  play: <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z" fill="currentColor" />,
  pause: (
    <g fill="currentColor">
      <rect x="6" y="5" width="4.5" height="14" rx="1.5" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1.5" />
    </g>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />,
  loop: line(['M4 12a6 6 0 0 1 6-6h8', 'm15 3 3 3-3 3', 'M20 12a6 6 0 0 1-6 6H6', 'm9 21-3-3 3-3']),
  speaker: line(['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11']),
  mute: line(['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'm16 9.5 5 5', 'm21 9.5-5 5']),
  mic: line(['M12 3.5a3 3 0 0 1 3 3V12a3 3 0 0 1-6 0V6.5a3 3 0 0 1 3-3Z', 'M6 11.5a6 6 0 0 0 12 0', 'M12 17.5v3']),
  back: line(['M15 5 8 12l7 7']),
  forward: line(['m9 5 7 7-7 7']),
  close: line(['M6 6l12 12', 'M18 6 6 18']),
  check: line(['m4.5 12.5 5 5 10-11']),
  copy: line(['M9 9h10.5v11.5H9z', 'M15 9V4.5H4.5V16H9']),
  flag: line(['M6 21V3.5', 'M6 4.5h11.5l-2.5 4 2.5 4H6']),
  plus: line(['M12 5v14', 'M5 12h14']),
  help: line(['M9.2 9a3 3 0 1 1 4.3 2.7c-1 .5-1.5 1.2-1.5 2.3v.5', 'M12 18h.01']),
  gear: line(['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7']),
  heart: <path d="M12 20.5s-8-4.8-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.6-8 10.4-8 10.4Z" fill="currentColor" />,
  gift: line(['M4 10h16v3H4z', 'M5.5 13h13v7.5h-13z', 'M12 10v10.5', 'M12 10c-1-3.5-5-4.5-5.5-2S10 10 12 10Z', 'M12 10c1-3.5 5-4.5 5.5-2S14 10 12 10Z']),
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" fill="currentColor" />,

  // Full-colour icons (currencies and rewards).
  flame: (
    <g>
      <path d="M12 2.5c1 3.5 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.3-4.1 2.5-5.3.3 1.6 1 2.6 2 3-.6-3 .2-6 1-8.7Z" fill="#ff6a2b" stroke="#c23d0b" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M12 12.5c.6 1.6 2.6 2.4 2.6 4.6a2.6 2.6 0 0 1-5.2 0c0-1.5.9-2.4 1.7-3 .1.7.4 1 .8 1.2-.2-1 0-2 .1-2.8Z" fill="#ffd60a" />
    </g>
  ),
  coin: (
    <g>
      <ellipse cx="12" cy="13.5" rx="8.5" ry="8" fill="#c98f00" />
      <ellipse cx="12" cy="11.5" rx="8.5" ry="8" fill="#ffc928" stroke="#c98f00" strokeWidth={1.5} />
      <path d="M14.5 8.3c-.6-.6-1.5-.9-2.5-.9-1.6 0-2.8.9-2.8 2.1 0 2.8 5.6 1.6 5.6 4.3 0 1.3-1.2 2.2-2.8 2.2-1.1 0-2.1-.4-2.7-1.1M12 5.8v1.6M12 15.9v1.6" fill="none" stroke="#8a5d00" strokeWidth={1.8} strokeLinecap="round" />
    </g>
  ),
  potion: (
    <g>
      <path d="M9.5 3.5h5M10.3 3.5v5L5.5 16.6A2.6 2.6 0 0 0 7.8 20.5h8.4a2.6 2.6 0 0 0 2.3-3.9L13.7 8.5v-5" fill="#fffdf7" stroke="#7440d1" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M7.2 14.5h9.6l1.7 2.4a2.2 2.2 0 0 1-1.9 3.3H7.4a2.2 2.2 0 0 1-1.9-3.3l1.7-2.4Z" fill="#a66bff" />
      <circle cx="10.5" cy="17.3" r="1" fill="#fffdf7" />
      <circle cx="13.6" cy="16.2" r="0.7" fill="#fffdf7" />
    </g>
  ),
  xp: (
    <g>
      <path d="M13.5 2.5 5 13.5h6l-1.5 8 9-11.5h-6l1-7.5Z" fill="#2591ff" stroke="#1467c4" strokeWidth={1.5} strokeLinejoin="round" />
    </g>
  ),
  chest: (
    <g strokeLinejoin="round">
      <path d="M3.5 10.5h17v9.5h-17z" fill="#d98b4a" stroke="#7a4214" strokeWidth={1.6} />
      <path d="M3.5 10.5a8.5 5.5 0 0 1 17 0" fill="#e8a467" stroke="#7a4214" strokeWidth={1.6} />
      <path d="M3.5 12.5h17" stroke="#ffc928" strokeWidth={2.2} />
      <rect x="10.2" y="11" width="3.6" height="4.4" rx="1" fill="#ffc928" stroke="#7a4214" strokeWidth={1.3} />
    </g>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: number;
  /** Accessible label; without it the icon is decorative (aria-hidden). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 24, label, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ flex: 'none', ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
