// The mascot as a React mark: the same drawing as the app icons (druid.ts). `tile` draws it as the
// home-screen icon (red field, burst); without it, the head alone on a transparent background.
import type { CSSProperties } from 'react';
import { DRUID, DRUID_SMALL, INK, RED, WHITE, YELLOW, burstPolygon, type Shape } from './druid';

export interface DruidMarkProps {
  size?: number;
  /** Draw it as the app icon: red field, yellow burst, white flash. */
  tile?: boolean;
  /** The simplified head (automatic under 40 px). */
  small?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const BURST_OUTER = burstPolygon(512, 16, 11, 0.24, 14);
const BURST_INNER = burstPolygon(512, 12, 5, 0.3, 120);

function ShapePath({ sh }: { sh: Shape }) {
  return (
    <path
      d={sh.d}
      fill={sh.fill}
      stroke={sh.sw > 0 ? (sh.stroke ?? INK) : undefined}
      strokeWidth={sh.sw > 0 ? sh.sw : undefined}
      strokeLinejoin="round"
      strokeLinecap={sh.cap}
    />
  );
}

export function DruidMark({ size = 48, tile = false, small, className, style, title }: DruidMarkProps) {
  const simple = small ?? size < 40;
  const shapes = simple ? DRUID_SMALL : DRUID;
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} style={style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {tile && (
        <>
          <rect width="512" height="512" fill={RED} />
          {!simple && <polygon points={BURST_OUTER} fill={YELLOW} stroke={INK} strokeWidth={10} strokeLinejoin="miter" />}
          {!simple && <polygon points={BURST_INNER} fill={WHITE} />}
          {simple && <rect x="40" y="40" width="432" height="432" fill={YELLOW} />}
        </>
      )}
      {shapes.map((sh, i) => (
        <ShapePath key={i} sh={sh} />
      ))}
    </svg>
  );
}
