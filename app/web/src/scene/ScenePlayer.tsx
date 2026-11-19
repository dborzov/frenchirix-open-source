// Plays a scene: the slideshow on top, the dialogue strip below (side by side on a landscape tablet),
// a big play/pause, the scene looping by default with the current line highlighted and followed (see
// `follow` below). Each line is a panel in its line's colour, the colour of its segment in the playback bar.
// Tapping a box in the strip loops that box instead, tapping a line's panel loops the line (again:
// the scene plays on from there); play resumes the scene from the line it was on.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { Scene } from '../../../shared/content';
import { t } from '../../../shared/i18n';
import { audio, useAudioClock, useAudioState } from '../audio';
import { fx } from '../fx';
import { IconButton, cx, useLayout } from '../ui';
import { DialogueStrip, type DialogueStripProps } from './DialogueStrip';
import { SceneBar } from './SceneBar';
import s from './ScenePlayer.module.css';
import { Slideshow } from './Slideshow';
import { lineAt, lineWindow, tags } from './timing';

export interface ScenePlayerProps {
  scene: Scene;
  autoPlay?: boolean; // default true
  loop?: boolean; // default true
  onFullWatch?: () => void; // the scene played to the end once (view mode reports it)
  /** A non-looping play reached the end. */
  onEnded?: () => void;
  /** The furthest position reached so far, in ms (the watch puzzle type uses it). */
  onProgress?: (maxMs: number) => void;
  lineIds?: string[]; // default: every line
  showEnglish?: boolean;
  /** Passed to the strip (hint counting, unit taps, …). */
  strip?: Partial<Omit<DialogueStripProps, 'scene' | 'lineIds'>>;
  /** 'auto' (default): side by side on a wide landscape screen; 'stack': always one column. */
  arrange?: 'auto' | 'stack';
  className?: string;
  /** Extra content under the strip. */
  footer?: ReactNode;
}

/** After a seek, the current line is not scrolled into view for this long (a tap's click comes after it). */
const SEEK_SCROLL_HOLD_MS = 700;
/** After the kid scrolls by hand (a swipe, the wheel), nothing follows the playing line for this long. */
const HAND_SCROLL_HOLD_MS = 4000;

/** The point of `el` at height `y` (viewport) is on screen and not under a bar (the tab bar, a sticky action bar). */
function shownAt(el: HTMLElement, y: number): boolean {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint?.(r.left + r.width / 2, y);
  return !!hit && el.contains(hit);
}

/** The strip scrolls in a box of its own (a landscape tablet): the box follows, never the page. */
function ownScrollBox(box: HTMLElement | null): HTMLElement | null {
  if (!box || box.scrollHeight <= box.clientHeight + 1) return null;
  return /auto|scroll/.test(getComputedStyle(box).overflowY) ? box : null;
}

export function ScenePlayer({ scene, autoPlay = true, loop = true, onFullWatch, onEnded, onProgress, lineIds, showEnglish, strip, arrange = 'auto', className, footer }: ScenePlayerProps) {
  const src = scene.audio.src;
  const tag = tags.scene(scene.id);
  const st = useAudioState();
  const layout = useLayout();
  // Anything of this scene playing (the scene, a looping line or box): the big button pauses it.
  const playing = st.playing && st.src === src;
  // Started but its audio is still on its way: the button is busy, never "pause" (nothing is heard yet).
  const busy = playing && st.loading;
  const lines = lineIds ? scene.lines.filter((l) => lineIds.includes(l.id)) : scene.lines;
  const ids = lines.map((l) => l.id); // in scene order, so the strip's colours are the bar's
  const resumeAt = useRef(0);
  const maxMs = useRef(0);
  const watched = useRef(false);
  const cb = useRef({ onFullWatch, onEnded, onProgress });
  cb.current = { onFullWatch, onEnded, onProgress };
  const lineEls = useRef(new Map<string, HTMLElement>());
  const playBtn = useRef<HTMLDivElement>(null);
  /** The current play was started before audio was unlocked (an autoplay on a cold load): silent so far. */
  const startedLocked = useRef(false);
  const seekedAt = useRef(0);
  const linesBox = useRef<HTMLDivElement>(null);
  const lastLine = useRef<string | null>(null);
  /** The kid touched or scrolled the page since it opened; and when they last scrolled it by hand. */
  const touched = useRef(false);
  const handAt = useRef(0);

  const start = useCallback(
    (fromMs = 0) => {
      startedLocked.current = !audio.isUnlocked();
      audio.playRange(src, 0, scene.audio.durationMs, {
        loop,
        tag,
        fromMs,
        onIteration: () => {
          if (!watched.current) {
            watched.current = true;
            cb.current.onFullWatch?.();
          }
        },
        onEnd: () => cb.current.onEnded?.(),
      });
    },
    [src, scene.audio.durationMs, loop, tag],
  );

  useEffect(() => {
    void audio.preload(src);
    if (autoPlay && !audio.isMuted()) start(0); // muted: nothing starts by itself
    return () => audio.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  // Follow the clock: the current line, the progress bar, the furthest point reached.
  const currentLine = useAudioClock((ms, as) => {
    if (!(as.playing && as.tag === tag) || as.loading) return null;
    return lineAt(lines, ms)?.id ?? null;
  });
  const pct = useAudioClock((ms, as) => (as.tag === tag && as.playing && !as.loading ? Math.round((ms / scene.audio.durationMs) * 200) / 2 : -1));
  useEffect(() => {
    if (pct < 0) return;
    const ms = (pct / 100) * scene.audio.durationMs;
    if (ms > maxMs.current) {
      maxMs.current = ms;
      cb.current.onProgress?.(ms);
    }
  }, [pct, scene.audio.durationMs]);
  // A line looping after a tap on its panel: play resumes the scene from there.
  const loopedLine = st.playing && st.src === src && st.tag?.startsWith('line:') ? lines.find((l) => tags.line(l.id) === st.tag) : undefined;
  useEffect(() => {
    if (!loopedLine) return;
    resumeAt.current = lineWindow(loopedLine).startMs;
    startedLocked.current = false; // the kid tapped: the next tap on the button pauses
  }, [loopedLine]);
  useEffect(() => {
    const tap = () => void (touched.current = true);
    const hand = () => {
      touched.current = true;
      handAt.current = Date.now();
    };
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', tap, opts);
    window.addEventListener('wheel', hand, opts);
    window.addEventListener('touchmove', hand, opts);
    return () => {
      window.removeEventListener('pointerdown', tap, opts);
      window.removeEventListener('wheel', hand, opts);
      window.removeEventListener('touchmove', hand, opts);
    };
  }, []);
  useEffect(() => {
    if (!currentLine) return;
    const prev = lastLine.current;
    lastLine.current = currentLine;
    const l = scene.lines.find((x) => x.id === currentLine);
    if (l) resumeAt.current = lineWindow(l).startMs;
    follow(prev, currentLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLine, scene.lines]);

  /**
   * Follow the playing line, so a kid reading the strip keeps it in view, without ever moving the page
   * under a kid who is doing something else. Never right after a seek (the page would move under the
   * finger still on the playback bar, and the tap's click would land on a line panel), nor while the kid
   * scrolls by hand and a few seconds after. The strip's own scroll box (landscape tablet) follows
   * whenever the line leaves it. The page follows only once the kid has touched it since arriving (it
   * never moves on arrival: the title and back button stay), and only by a small step: from a line on
   * screen to the next line of the strip when that one is not on screen whole. So it never jumps (the
   * loop's restart, a seek), and a kid who scrolled down to the notes or the next scene is never pulled
   * back up.
   */
  function follow(prev: string | null, id: string) {
    const now = Date.now();
    if (now - seekedAt.current < SEEK_SCROLL_HOLD_MS || now - handAt.current < HAND_SCROLL_HOLD_MS) return;
    const el = lineEls.current.get(id);
    if (!el) return;
    const behavior = fx.reducedMotion() ? 'auto' : 'smooth';
    const box = ownScrollBox(linesBox.current);
    if (box) {
      // The part of the box on screen: inside the box, and inside the line's scroll margins (they keep
      // it off the top bar and a sticky action bar).
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const top = Math.max(b.top, parseFloat(cs.scrollMarginTop) || 0);
      const bottom = Math.min(b.bottom, innerHeight - (parseFloat(cs.scrollMarginBottom) || 0));
      if (r.bottom > bottom && r.height < bottom - top) box.scrollBy({ top: r.bottom - bottom, behavior });
      else if (r.top < top || r.bottom > bottom) box.scrollBy({ top: r.top - top, behavior });
      return;
    }
    const was = prev ? lineEls.current.get(prev) : undefined;
    if (!touched.current || !was || ids.indexOf(id) !== ids.indexOf(prev!) + 1) return;
    const w = was.getBoundingClientRect();
    if (!shownAt(was, w.top + w.height / 2)) return;
    const r = el.getBoundingClientRect();
    if (shownAt(el, r.top + 4) && shownAt(el, r.bottom - 4)) return;
    el.scrollIntoView?.({ block: 'nearest', behavior });
  }

  const toggle = () => {
    if (busy && !startedLocked.current) return; // the sound is on its way: a tap does not cancel it
    if (playBtn.current) fx.pop(playBtn.current);
    // An autoplay started before the first touch is scheduled but silent (the audio context waits
    // for a gesture): the kid's first tap on the button means "play", so start over instead of pausing.
    if (playing && !startedLocked.current) {
      audio.stop();
    } else if (playing) {
      start(0);
      startedLocked.current = false; // this tap unlocks audio: the next tap pauses
    } else {
      start(resumeAt.current >= scene.audio.durationMs - 300 ? 0 : resumeAt.current);
    }
  };

  // Seek (the playback bar, a line's play control): the scene plays on from there.
  const seek = (ms: number) => {
    seekedAt.current = Date.now();
    resumeAt.current = ms;
    start(Math.max(0, Math.min(scene.audio.durationMs - 100, ms)));
    startedLocked.current = false;
  };

  const lineRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) lineEls.current.set(id, el);
    else lineEls.current.delete(id);
  }, []);

  return (
    <div className={cx(s.player, arrange === 'auto' && s.auto, className)} data-scene-player>
      <div className={s.media}>
        <Slideshow frames={scene.frames} audioSrc={src} alt={scene.titleFr}>
          <div className={s.controls} ref={playBtn}>
            <IconButton
              icon={playing ? 'pause' : 'play'}
              busy={busy}
              label={busy ? t('common.media.busy') : playing ? t('scene.player.pause') : t('scene.player.play')}
              color={playing ? 'yellow' : 'lime'}
              size={layout === 'tablet' ? 'xl' : 'lg'}
              className={cx(!playing && s.invite)}
              onClick={toggle}
              data-scene-play
            />
          </div>
        </Slideshow>
        <SceneBar lines={lines} durationMs={scene.audio.durationMs} src={src} onSeek={seek} className={s.sceneBar} />
      </div>
      <div className={s.lines} ref={linesBox}>
        <DialogueStrip scene={scene} lineIds={ids} activeLineId={currentLine} showEnglish={showEnglish} lineRef={lineRef} onLineSeek={(l) => seek(lineWindow(l).startMs)} linePanels {...strip} />
        {footer}
      </div>
    </div>
  );
}
