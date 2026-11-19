// The slideshow: the frame for the current audio position, with a soft cross-fade and a slow drift
// so it feels alive. Either give it `timeMs`, or give it `audioSrc` and it follows the audio clock
// while that clip plays (holding the last frame when it stops).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Frame } from '../../../shared/content';
import { useAudioClock } from '../audio';
import { cx } from '../ui';
import s from './Slideshow.module.css';

export interface SlideshowProps {
  frames: Frame[];
  timeMs?: number; // position in the clip; when absent, follows the audio clock of `audioSrc`
  audioSrc?: string;
  /** Shown when nothing plays and no timeMs is given (ms in the clip). */
  restMs?: number;
  alt?: string;
  className?: string;
  /** 'wide' (16:9, default) or 'fill' (fills its parent). */
  fit?: 'wide' | 'fill';
  drift?: boolean; // default true
  /** While the engine's play has a tag this returns true for, keep the frame shown (see SceneBar). */
  holdWhile?: (tag: string | null) => boolean;
  children?: ReactNode; // overlays (play button, badges)
}

/** The frame showing at timeMs: the last frame whose t <= timeMs. */
export function frameAt(frames: Frame[], timeMs: number): Frame | undefined {
  let current = frames[0];
  for (const f of frames) if (f.t <= timeMs) current = f;
  return current;
}

export function Slideshow({ frames, timeMs, audioSrc, restMs = 0, alt = '', className, fit = 'wide', drift = true, holdWhile, children }: SlideshowProps) {
  const lastRef = useRef<string | undefined>(undefined);
  const followed = useAudioClock((ms, st) => {
    if (timeMs !== undefined || !audioSrc) return null;
    if (holdWhile?.(st.tag)) return null; // null keeps the last frame
    if (st.src === audioSrc && st.playing && !st.loading) return frameAt(frames, ms)?.src ?? null;
    return null;
  });
  const src = useMemo(() => {
    if (timeMs !== undefined) return frameAt(frames, timeMs)?.src;
    if (followed) return (lastRef.current = followed);
    const last = lastRef.current;
    return last && frames.some((f) => f.src === last) ? last : frameAt(frames, restMs)?.src;
  }, [frames, timeMs, followed, restMs]);

  // Layers: the newest on top fades in; keep the previous under it until the fade is done.
  const [layers, setLayers] = useState<{ src: string; key: number }[]>(() => (src ? [{ src, key: 0 }] : []));
  const keyRef = useRef(1);
  useEffect(() => {
    if (!src) return;
    setLayers((ls) => (ls[ls.length - 1]?.src === src ? ls : [...ls.slice(-1), { src, key: keyRef.current++ }]));
  }, [src]);

  // Warm the cache with the frames so cross-fades never wait on the network.
  useEffect(() => {
    for (const f of frames.slice(0, 12)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = f.src;
    }
  }, [frames]);

  return (
    <div className={cx(s.show, fit === 'fill' && s.fill, className)} data-slideshow data-frame={src}>
      <div className={cx(s.drift, drift && s.drifting)}>
        {layers.map((l, i) => (
          <img key={l.key} src={l.src} alt={i === layers.length - 1 ? alt : ''} className={cx(s.img, i === layers.length - 1 && layers.length > 1 && s.fadeIn)} draggable={false} />
        ))}
      </div>
      {children}
    </div>
  );
}
