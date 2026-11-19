// One item on its own (loot, shop, gifts, the editor's grid), framed to fit its drawing.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_AVATAR, ITEMS_BY_ID, type ItemSlot } from '../../../shared/catalog';
import { itemArt, makeCtx } from './Avatar';
import { HalftoneDefs, INK, LAYERS } from './art/kit';
import s from './Avatar.module.css';

export interface ItemIconProps {
  itemId: string;
  size: number;
  className?: string;
  /** Blacked out: a locked item the kid does not own yet. */
  silhouette?: boolean;
  label?: string;
}

const SLOT_VIEW: Record<ItemSlot, string> = {
  hat: '30 -6 140 140',
  hair: '40 0 130 130',
  face: '52 40 96 96',
  top: '50 96 100 100',
  bottom: '62 128 76 76',
  feet: '62 150 76 76',
  held: '100 60 110 110',
  back: '10 60 180 180',
  pet: '2 108 80 80',
  background: '0 0 200 200',
};

export function ItemIcon({ itemId, size, className, silhouette, label }: ItemIconProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const item = ITEMS_BY_ID.get(itemId);
  const art = itemArt(itemId);
  const ref = useRef<SVGGElement>(null);
  const slotView = item ? SLOT_VIEW[item.slot] : '0 0 200 200';
  const [view, setView] = useState(slotView);

  useLayoutEffect(() => {
    if (!item || item.slot === 'background') return setView(slotView);
    const g = ref.current;
    if (!g || typeof g.getBBox !== 'function') return;
    try {
      const b = g.getBBox();
      if (!b.width || !b.height) return;
      const side = Math.max(b.width, b.height) + 12;
      setView(`${(b.x + b.width / 2 - side / 2).toFixed(1)} ${(b.y + b.height / 2 - side / 2).toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`);
    } catch {
      /* not rendered (tests): keep the slot's frame */
    }
  }, [itemId, item, slotView]);

  if (!item || !art) return <svg width={size} height={size} className={className} aria-label={label ?? itemId} role="img" />;
  const c = makeCtx(DEFAULT_AVATAR, uid, size >= 72);
  return (
    <svg
      className={[s.avatar, className].filter(Boolean).join(' ')}
      viewBox={view}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? item.name.fr}
      style={silhouette ? { filter: 'brightness(0)' } : undefined}
    >
      <defs>
        <HalftoneDefs uid={uid} />
      </defs>
      <g ref={ref} stroke={INK} strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round">
        {LAYERS.map((layer) => {
          const draw = art.layers[layer];
          return draw ? <g key={layer}>{draw(c)}</g> : null;
        })}
      </g>
    </svg>
  );
}
