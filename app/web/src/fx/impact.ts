// Comic impacts (docs/app-style.md): a jagged burst slamming in with a French sound word, radiating
// speed lines, a one-frame flash and a shake. Built as inline SVG + Web Animations in the fx overlay.

export interface ImpactOpts {
  size?: 'sm' | 'md' | 'lg';
  fill?: string; // burst colour (default alternates white and yellow)
  ink?: string;
  tilt?: number; // degrees; default random -8..8
  lines?: boolean; // speed lines (default true for md/lg)
  flash?: boolean; // one-frame flash (default true for lg)
  holdMs?: number;
}

const FILLS = ['#FFFFFF', '#FFD21F'];
let fillIdx = 0;

/** A jagged starburst polygon: n spikes alternating outer radius (jittered) and inner radius. */
export function burstPoints(n: number, rOuter: number, rInner: number, cx: number, cy: number, jitter = 0.18): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI / n) * i - Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / n) * 0.5;
    const r = i % 2 === 0 ? rOuter * (1 - Math.random() * jitter) : rInner * (1 - Math.random() * jitter * 0.6);
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

function speedLines(cx: number, cy: number, r0: number, r1: number, n: number, ink: string): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.25;
    const ra = r0 * (0.95 + Math.random() * 0.2);
    const rb = r1 * (0.8 + Math.random() * 0.25);
    const w = 3 + Math.random() * 5;
    const x1 = cx + Math.cos(a) * ra;
    const y1 = cy + Math.sin(a) * ra;
    const x2 = cx + Math.cos(a) * rb;
    const y2 = cy + Math.sin(a) * rb;
    // A wedge: thin at the burst, wider outside, in ink.
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    out += `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${(x2 + nx).toFixed(1)},${(y2 + ny).toFixed(1)} ${(x2 - nx).toFixed(1)},${(y2 - ny).toFixed(1)}" fill="${ink}"/>`;
  }
  return out;
}

export function makeImpact(word: string, opts: ImpactOpts = {}): { el: HTMLDivElement; size: number } {
  const sizeKey = opts.size ?? 'md';
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const size = sizeKey === 'lg' ? Math.min(vw * 0.86, 420) : sizeKey === 'md' ? Math.min(vw * 0.6, 260) : 150;
  const ink = opts.ink ?? '#111111';
  const fill = opts.fill ?? FILLS[fillIdx++ % FILLS.length]!;
  const V = 200;
  const c = V / 2;
  const lines = opts.lines ?? sizeKey !== 'sm';
  const svg = `<svg viewBox="0 0 ${V} ${V}" width="${size}" height="${size}" style="overflow:visible;display:block">
    ${lines ? speedLines(c, c, V * 0.42, V * 0.78, 22, ink) : ''}
    <polygon points="${burstPoints(15, V * 0.47, V * 0.3, c + 3, c + 4)}" fill="${ink}"/>
    <polygon points="${burstPoints(15, V * 0.47, V * 0.3, c, c)}" fill="${fill}" stroke="${ink}" stroke-width="4" stroke-linejoin="miter"/>
  </svg>`;
  const el = document.createElement('div');
  el.dataset.fx = 'impact';
  Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: `${size}px`, height: `${size}px`, willChange: 'transform, opacity' });
  el.innerHTML = svg;
  const label = document.createElement('div');
  label.textContent = word;
  const fs = Math.max(18, Math.min(size * 0.24, (size * 1.05) / Math.max(3, word.length * 0.62)));
  Object.assign(label.style, {
    position: 'absolute',
    inset: '0',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'var(--font-display)',
    fontSize: `${fs}px`,
    lineHeight: '1',
    color: ink,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    transform: 'skewX(-8deg)',
    WebkitTextStroke: '0',
    textShadow: `3px 3px 0 ${fill === '#FFFFFF' ? '#FFD21F' : '#FFFFFF'}`,
    paddingTop: '0.12em',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(label);
  return { el, size };
}
