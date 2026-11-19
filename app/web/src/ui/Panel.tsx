import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { colorVars, cx, type BlockColor } from './colors';
import s from './Panel.module.css';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Fill: cream paper by default, or a flat block colour. */
  color?: BlockColor;
  /** Tilt in degrees (2-3 looks hand-placed); `true` = -1.5. */
  tilt?: number | boolean;
  padding?: 'normal' | 'tight' | 'none';
  /** 3 px frame and a smaller shadow, for small panels. */
  thin?: boolean;
  /** Halftone dots in the fill. */
  dots?: boolean;
  children?: ReactNode;
}

export function panelStyle(color: BlockColor | undefined, tilt: number | boolean | undefined, style?: CSSProperties): CSSProperties {
  const deg = tilt === true ? -1.5 : typeof tilt === 'number' ? tilt : 0;
  return { ...(color ? colorVars(color) : null), ...(deg ? { '--tilt': `${deg}deg` } : null), ...style } as CSSProperties;
}

export function panelClass(opts: { padding?: 'normal' | 'tight' | 'none'; thin?: boolean; dots?: boolean; interactive?: boolean }, className?: string): string {
  return cx(s.panel, opts.thin && s.thin, opts.dots && s.dots, opts.padding === 'tight' && s.tight, opts.padding === 'none' && s.flat, opts.interactive && s.interactive, className);
}

/** A comic panel: thick ink frame, hard shadow, cream or coloured, optionally tilted. */
export function Panel({ color, tilt, padding = 'normal', thin, dots, className, style, ...rest }: PanelProps) {
  return <div className={panelClass({ padding, thin, dots }, className)} style={panelStyle(color, tilt, style)} {...rest} />;
}
