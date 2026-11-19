// A small canvas particle system for the effects kit: one full-screen canvas over everything
// (pointer-events: none, z-index --z-fx), created on first use, animating only while particles live.
// Sprites are pre-rendered once per kind and colour, so a frame is only drawImage calls (fast on old iPads).

export type ParticleKind = 'confetti' | 'star' | 'coin' | 'spark' | 'heart' | 'dot';

interface P {
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number; // gravity px/s²
  drag: number;
  rot: number;
  vr: number;
  size: number;
  life: number; // seconds left
  total: number;
  flutter: number; // confetti: x wobble and flip
  phase: number;
  spin: boolean; // coin: flip on X
}

// Flat printing-ink colours (docs/app-style.md); every particle has a black ink outline.
const COLORS = ['#E8303A', '#FFD21F', '#1E88E5', '#22B14C', '#FF7A1A', '#7A3FF2', '#FFFFFF'];
const MAX_PARTICLES = 420;

let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let parts: P[] = [];
let raf = 0;
let last = 0;
let dpr = 1;
const sprites = new Map<string, HTMLCanvasElement>();

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx2d && canvas?.isConnected) return ctx2d;
  if (typeof document === 'undefined') return null;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.fx = 'particles';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 'var(--z-fx, 500)' });
  document.body.appendChild(canvas);
  ctx2d = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  return ctx2d;
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

function sprite(kind: ParticleKind, color: string): HTMLCanvasElement {
  const key = `${kind}:${color}`;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const S = 48;
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.lineJoin = 'round';
  const ink = '#111111';
  switch (kind) {
    case 'confetti':
      g.fillStyle = color;
      g.fillRect(-10, -6, 20, 12);
      g.lineWidth = 3;
      g.strokeStyle = ink;
      g.strokeRect(-10, -6, 20, 12);
      break;
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 9 : 20;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = ink;
      g.stroke();
      break;
    }
    case 'coin':
      g.beginPath();
      g.arc(0, 0, 17, 0, Math.PI * 2);
      g.fillStyle = '#ffc928';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = ink;
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 10, 0, Math.PI * 2);
      g.strokeStyle = '#c98f00';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#fff6c4';
      g.fillRect(-9, -11, 4, 6);
      break;
    case 'spark':
      g.lineCap = 'square';
      g.strokeStyle = ink;
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(-15, 0);
      g.lineTo(15, 0);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-14, 0);
      g.lineTo(14, 0);
      g.stroke();
      break;
    case 'heart':
      g.beginPath();
      g.moveTo(0, 14);
      g.bezierCurveTo(-22, -2, -10, -20, 0, -8);
      g.bezierCurveTo(10, -20, 22, -2, 0, 14);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = ink;
      g.stroke();
      break;
    default:
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = ink;
      g.stroke();
  }
  sprites.set(key, c);
  return c;
}

export interface EmitOpts {
  x: number;
  y: number;
  kind: ParticleKind;
  count: number;
  colors?: string[];
  speed?: number; // px/s
  spread?: number; // radians, around `angle`
  angle?: number; // radians; -PI/2 = up
  gravity?: number;
  size?: number; // px
  life?: number; // s
  width?: number; // emit along a horizontal line this wide (rain)
}

export function emit(o: EmitOpts): void {
  if (!ensureCanvas()) return;
  const colors = o.colors ?? COLORS;
  const room = Math.max(0, MAX_PARTICLES - parts.length);
  const n = Math.min(o.count, room);
  for (let i = 0; i < n; i++) {
    const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
    const sp = (o.speed ?? 420) * (0.45 + Math.random() * 0.75);
    const life = (o.life ?? 1.2) * (0.7 + Math.random() * 0.6);
    const color = colors[Math.floor(Math.random() * colors.length)]!;
    parts.push({
      sprite: sprite(o.kind, color),
      x: o.x + (o.width ? (Math.random() - 0.5) * o.width : 0),
      y: o.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      g: o.gravity ?? 900,
      drag: o.kind === 'confetti' ? 1.6 : 0.9,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * (o.kind === 'spark' ? 0 : 10),
      size: (o.size ?? 18) * (0.7 + Math.random() * 0.6),
      life,
      total: life,
      flutter: o.kind === 'confetti' ? 1 : 0,
      phase: Math.random() * 6.28,
      spin: o.kind === 'coin',
    });
  }
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function frame(now: number) {
  const g = ctx2d;
  if (!g || !canvas) {
    raf = 0;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const alive: P[] = [];
  for (const p of parts) {
    p.life -= dt;
    if (p.life <= 0) continue;
    const k = Math.exp(-p.drag * dt);
    p.vx *= k;
    p.vy = p.vy * k + p.g * dt;
    p.phase += dt * 8;
    p.x += (p.vx + (p.flutter ? Math.sin(p.phase) * 40 : 0)) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.y > window.innerHeight + 60) continue;
    alive.push(p);
    const fade = Math.min(1, p.life / Math.min(0.35, p.total * 0.4));
    const sx = p.spin || p.flutter ? Math.cos(p.phase) : 1;
    const s = (p.size / 48) * dpr;
    g.globalAlpha = fade;
    g.setTransform(s * Math.cos(p.rot) * (Math.abs(sx) < 0.08 ? 0.08 : sx), s * Math.sin(p.rot), -s * Math.sin(p.rot), s * Math.cos(p.rot), p.x * dpr, p.y * dpr);
    g.drawImage(p.sprite, -24, -24);
  }
  g.globalAlpha = 1;
  parts = alive;
  if (parts.length) raf = requestAnimationFrame(frame);
  else {
    raf = 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function particleCount(): number {
  return parts.length;
}

export function clearParticles(): void {
  parts = [];
}
