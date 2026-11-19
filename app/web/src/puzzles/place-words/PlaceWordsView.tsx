// The view of `place-words`, the opener of a practice: the whole scene loops with its slideshow and
// its dialogue. Each line is a panel in its line's colour, the colour of its segment in the playback
// bar; the line being said turns full colour. Some boxes of the dialogue are empty gaps (dashed white
// slots) and their pieces wait in a tray. Either order places a piece:
//   - a piece, then a gap: the piece speaks (a second tap shows its English), the open gaps beckon,
//     the tapped gap takes it;
//   - a gap, then a piece: the gap turns ink and its line loops, the tray calls, the tapped piece
//     goes there (a wrong one speaks, so the kid hears it does not fit).
// A wrong move shakes and bounces back; the item selected first stays selected. After two wrong
// moves on the selected item, its answer glows (placeReveal). Tapping a line's panel outside its
// boxes loops that line (selected: it slams in, dashed frame, loop tag, marked on the bar); tapping
// it again lets the scene play on from there; another line, the play button or the bar end it too.
// Tapping any other box says it once and shows its English, then the looping line or the scene goes
// on. When every piece is in, the scene plays once more, whole.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLater } from '../useLater';
import type { Line, Unit } from '../../../../shared/content';
import { placeReveal, type PlaceWordsAction, type PlaceWordsState, type PlaceWordsPuzzle } from '../../../../shared/puzzles/place-words';
import { t } from '../../../../shared/i18n';
import { audio, useAudioClock, useAudioState, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { hint, useHintAnchor } from '../../scene/hint';
import { lineColorVars, unitOnLineColorVars } from '../../scene/lineColors';
import { SceneBar } from '../../scene/SceneBar';
import { Slideshow } from '../../scene/Slideshow';
import { findLine, findUnit, lineAt, lineWindow, loopWindowFor, tags } from '../../scene/timing';
import { Icon, Spinner, cx } from '../../ui';
import { getFlag, setFlag } from '../../onboarding/storage';
import { rememberOrigin, useFlyIn } from '../arcade/kit';
import type { PuzzleViewProps } from '../registry';
import lp from '../../scene/LinePanel.module.css';
import s from './PlaceWords.module.css';

/** Device flag for the tap-again tip (onboarding storage, prefix frenchirix.onb.). */
const TIP_FLAG = 'tip.place-words-tap';
const TIP_MS = 9000;

const lineOf = (unitId: string) => unitId.slice(0, unitId.lastIndexOf(':'));
const smooth = (): ScrollBehavior => (fx.reducedMotion() ? 'auto' : 'smooth');
/** The element that scrolls `el` (the practice's puzzle column), else the page. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  return document.documentElement;
}
/** A tray piece speaking (sayOnce with asPiece): the bar and the slideshow must not show where. */
const isPieceTag = (tag: string | null) => !!tag && tag.startsWith('piece:');

interface GapProps {
  unit: Unit;
  colour: CSSProperties;
  filled: boolean;
  /** The selected gap (a gap first). */
  on: boolean;
  /** A piece is picked: open gaps beckon. */
  ready: boolean;
  glow: boolean;
  onTap: (el: HTMLElement) => void;
}

function Gap({ unit, colour, filled, on, ready, glow, onTap }: GapProps) {
  const ref = useFlyIn<HTMLButtonElement>(filled ? `pw:${unit.id}` : null, { ms: 460 });
  return (
    <button
      ref={ref}
      type="button"
      className={cx(s.box, filled ? s.filled : s.gap, !filled && on && s.gapOn, !filled && ready && !glow && s.gapReady, glow && s.glow)}
      style={filled ? colour : ({ '--w': `${Math.min(13, Math.max(3, unit.fr.length * 0.6))}ch` } as CSSProperties)}
      onClick={(e) => onTap(e.currentTarget)}
      data-gap={unit.id}
      data-gap-on={!filled && on ? '' : undefined}
      aria-pressed={filled ? undefined : on}
      aria-label={filled ? unit.fr : t('puzzles.place-words.gap')}
    >
      {filled ? <span>{unit.fr}</span> : <Icon name="plus" size={20} className={s.plus} />}
    </button>
  );
}

export function PlaceWordsView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<PlaceWordsPuzzle, PlaceWordsState, PlaceWordsAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const done = state.placed.length >= puzzle.gaps.length;
  const src = scene.audio.src;
  const sceneTag = tags.scene(scene.id);
  const engine = useAudioState();
  const [selected, setSelected] = useState<string | null>(null); // the picked piece (a piece first)
  const [selGap, setSelGap] = useState<string | null>(null); // the selected gap (a gap first)
  const [loopLine, setLoopLineState] = useState<string | null>(null); // the line looping after a tap
  const loopLineRef = useRef<string | null>(null);
  const setLoopLine = (id: string | null) => {
    loopLineRef.current = id;
    setLoopLineState(id);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const resumeAt = useRef(0);
  const finale = useRef(false);
  // The first time ever on this device: a one-line tip by the tray (tap to pick, tap again for the
  // meaning). It goes after the first second tap or a few seconds, and never blocks a tap.
  const [tip, setTip] = useState(() => !getFlag(TIP_FLAG));
  const endTip = () => {
    setFlag(TIP_FLAG);
    setTip(false);
  };
  useEffect(() => {
    if (!tip) return;
    const h = window.setTimeout(endTip, TIP_MS);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useStopAudioOnUnmount();
  const later = useLater(); // delayed plays die with the puzzle

  const playScene = (fromMs = 0, loop = true) => audio.playRange(src, 0, scene.audio.durationMs, { loop, tag: sceneTag, ...(fromMs > 0 ? { fromMs } : {}) });

  const playLine = (id: string) => {
    const l = findLine(scene, id);
    if (!l) return;
    const w = lineWindow(l);
    audio.playRange(src, w.startMs, w.endMs, { loop: true, tag: tags.line(id) });
  };

  useEffect(() => {
    playScene(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  /**
   * Says one unit once, then the looping line, or the scene from where it was, goes on. A tray piece
   * speaks under its own tag (`asPiece`): the bar and the slideshow hold while it plays, since where
   * it is heard is the answer. A box in a line may move them (that line is on screen anyway).
   */
  const sayOnce = (unitId: string, asPiece = false) => {
    const r = findUnit(scene, unitId);
    if (!r) return;
    const st = audio.getState();
    if (st.tag === sceneTag && st.playing) resumeAt.current = audio.getPositionMs();
    const w = loopWindowFor(r.line, r.unit);
    audio.playRange(src, w.startMs, w.endMs, {
      loop: false,
      tag: asPiece ? tags.piece(unitId) : tags.unit(unitId),
      onEnd: () => {
        if (finale.current) return;
        if (loopLineRef.current) playLine(loopLineRef.current);
        else playScene(resumeAt.current);
      },
    });
  };

  /** Selects a line: it loops (unless it already does), and a selected gap elsewhere is let go. */
  const selectLine = (id: string) => {
    const l = findLine(scene, id);
    if (!l) return;
    resumeAt.current = lineWindow(l).startMs;
    const st = audio.getState();
    if (!(loopLineRef.current === id && st.playing && st.tag === tags.line(id))) playLine(id);
    setLoopLine(id);
    if (selGap && lineOf(selGap) !== id) setSelGap(null);
  };

  /** A tap on a line's panel outside its boxes: loop it; again, the scene plays on from there. */
  const tapLine = (id: string) => {
    fx.sfx('tap');
    if (loopLineRef.current === id) {
      setLoopLine(null);
      playScene(resumeAt.current, !done);
      return;
    }
    selectLine(id);
  };

  // The line being said, while the scene plays.
  const litLine = useAudioClock((ms, st) => (st.tag === sceneTag && st.playing ? (lineAt(scene.lines, ms)?.id ?? null) : null));

  /** Puts a piece in a gap, whichever was chosen first. */
  const place = (piece: string, gap: string) => {
    const root = rootRef.current;
    const pieceEl = root?.querySelector(`[data-piece="${CSS.escape(piece)}"]`) ?? null;
    const gapEl = root?.querySelector(`[data-gap="${CSS.escape(gap)}"]`) ?? null;
    hint.hide();
    if (piece === gap) {
      rememberOrigin(`pw:${piece}`, pieceEl);
      fx.sfx('pop');
      fx.haptic();
      if (gapEl) later(() => fx.impact(t('practice.fx.tchac'), gapEl, { size: 'sm' }), 380);
      setSelected(null);
      setSelGap(null);
      if (state.placed.length + 1 >= puzzle.gaps.length) {
        // The reward: the whole scene, once, from the start.
        finale.current = true;
        setLoopLine(null);
        later(() => {
          fx.impact(undefined, undefined, { size: 'lg' });
          fx.confetti();
          playScene(0, false);
        }, 700);
      }
    } else {
      if (gapEl) fx.wrong(gapEl);
      if (pieceEl) fx.shake(pieceEl);
      // A gap first: hear the piece that does not fit there, then its line again.
      if (selGap) sayOnce(piece, true);
    }
    dispatch({ kind: 'place', piece, gap });
  };

  const pick = (id: string, el: HTMLElement) => {
    if (done) return;
    if (selGap) {
      place(id, selGap);
      return;
    }
    fx.pop(el);
    fx.sfx('tap');
    // All of it in sight in the phone's sideways tray, its "?" tag too (scroll-margin).
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: smooth() });
    // First tap: pick the piece and hear it. A second tap on the picked piece shows its meaning in
    // the shared hint bubble (not on the first tap: the bubble would cover the gaps the kid aims at,
    // and a tap on the bubble only hides it). The piece stays picked either way.
    const again = id === selected;
    setSelected(id);
    sayOnce(id, true);
    const u = findUnit(scene, id)?.unit;
    if (again && u) {
      hint.toggle(el, { en: u.en, note: u.note });
      if (tip) endTip();
    } else hint.hide();
  };

  const tapGap = (gap: string, el: HTMLElement) => {
    if (state.placed.includes(gap)) {
      sayOnce(gap);
      const u = findUnit(scene, gap)?.unit;
      if (u) hint.toggle(el, { en: u.en, note: u.note });
      return;
    }
    if (selected) {
      place(selected, gap);
      return;
    }
    // A gap first: select it (again: let it go) and loop its line, so the kid hears what is missing.
    fx.pop(el);
    fx.sfx('tap');
    hint.hide();
    if (selGap === gap) {
      setSelGap(null);
      return;
    }
    selectLine(lineOf(gap));
    setSelGap(gap);
    showGap(gap);
  };

  const tapBox = (u: Unit, el: HTMLElement) => {
    fx.pop(el);
    sayOnce(u.id);
    hint.toggle(el, { en: u.en, note: u.note });
  };

  /**
   * On a phone or an upright tablet the tray sticks to the bottom of the screen, over the end of the
   * dialogue: a gap that matters is scrolled into sight above it (the gaps' scroll-margin is the
   * tray's height, --tray-h).
   */
  function trayTop(root: HTMLElement): number | null {
    const wrap = root.querySelector<HTMLElement>('[data-tray-wrap]');
    const sticky = wrap ? getComputedStyle(wrap) : null;
    if (!wrap || sticky?.position !== 'sticky') {
      root.style.setProperty('--tray-h', '0px');
      return null;
    }
    // What it covers when stuck: its height, its offset from the bottom and the scroller's padding.
    const covers = wrap.offsetHeight + (parseFloat(sticky.bottom) || 0) + (parseFloat(getComputedStyle(scrollerOf(root)).paddingBottom) || 0);
    root.style.setProperty('--tray-h', `${Math.round(covers)}px`);
    return wrap.getBoundingClientRect().top;
  }
  function showGap(gap: string, block: ScrollLogicalPosition = 'nearest') {
    const root = rootRef.current;
    if (!root) return;
    trayTop(root);
    root.querySelector(`[data-gap="${CSS.escape(gap)}"]`)?.scrollIntoView?.({ block, inline: 'nearest', behavior: smooth() });
  }

  const reveal = placeReveal(puzzle, state, { piece: selected, gap: selGap });
  // A piece that glows for the selected gap may sit off screen in the phone's sideways tray.
  const glowPiece = selGap ? reveal : null;
  useEffect(() => {
    if (!glowPiece) return;
    rootRef.current?.querySelector(`[data-piece="${CSS.escape(glowPiece)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: smooth() });
  }, [glowPiece]);
  // The gap that glows for the picked piece may be lines away in a long scene, or under the sticky
  // tray: bring it to the middle of the screen.
  const glowGap = selected ? reveal : null;
  useEffect(() => {
    if (glowGap) showGap(glowGap, 'center');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowGap]);
  // A piece is picked and every open gap is out of sight (scrolled away, or under the tray): bring the
  // nearest one into sight, so the kid sees the gaps beckon.
  useEffect(() => {
    const root = rootRef.current;
    if (!selected || !root) return;
    const view = scrollerOf(root).getBoundingClientRect();
    const top = Math.max(0, view.top);
    const bottom = trayTop(root) ?? Math.min(innerHeight, view.bottom);
    const open = puzzle.gaps.filter((g) => !state.placed.includes(g));
    const dist = open.map((g) => {
      const r = root.querySelector(`[data-gap="${CSS.escape(g)}"]`)?.getBoundingClientRect();
      return { g, d: !r ? Infinity : r.top < top ? top - r.top : r.bottom > bottom ? r.bottom - bottom : 0 };
    });
    if (dist.length && dist.every((x) => x.d > 0)) showGap(dist.reduce((a, b) => (b.d < a.d ? b : a)).g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const open = useHintAnchor();
  const openUnit = open instanceof HTMLElement ? (open.dataset.unit ?? null) : null;
  const anyOn = engine.playing && engine.src === src; // the scene, a looping line or a box speaking

  const renderLine = (line: Line, li: number) => {
    const parts: ReactNode[] = [];
    let pos = 0;
    const text = (str: string, key: string) => {
      str.split('\n').forEach((p, i) => {
        if (i > 0) parts.push(<span key={`${key}br${i}`} className={s.br} />);
        if (p.trim()) parts.push(<span key={`${key}t${i}`} className={s.punct}>{p.trim()}</span>);
      });
    };
    line.units.forEach((u, i) => {
      text(line.fr.slice(pos, u.cs), `${u.id}p`);
      pos = u.ce;
      const colour = unitOnLineColorVars(i, li);
      if (puzzle.gaps.includes(u.id)) {
        const filled = state.placed.includes(u.id);
        parts.push(<Gap key={u.id} unit={u} colour={colour} filled={filled} on={selGap === u.id} ready={!!selected} glow={!!selected && reveal === u.id} onTap={(el) => tapGap(u.id, el)} />);
      } else
        parts.push(
          <button key={u.id} type="button" className={cx(s.box, s.plain, openUnit === u.id && s.open)} style={colour} onClick={(e) => tapBox(u, e.currentTarget)} data-unit={u.id}>
            <span>{u.fr}</span>
          </button>,
        );
    });
    text(line.fr.slice(pos), `${line.id}end`);
    const looping = loopLine === line.id;
    return (
      <li key={line.id} className={cx(s.line, lp.panel, looping ? lp.looping : litLine === line.id && lp.lit)} style={lineColorVars(li)} data-line={line.id} data-looping={looping ? '' : undefined}>
        <button type="button" className={lp.hit} onClick={() => tapLine(line.id)} aria-label={t('scene.strip.playLine')} aria-pressed={looping} data-line-loop={line.id} />
        {looping && (
          <span className={lp.tag} aria-hidden="true">
            <Icon name="loop" size={16} />
          </span>
        )}
        {line.speaker && <span className={cx(s.speaker, lp.content, lp.speaker)}>{line.speaker}</span>}
        <div className={cx(s.row, lp.content)}>{parts}</div>
      </li>
    );
  };

  const step = done ? 'done' : selected ? 'piece' : selGap ? 'gap' : 'idle';
  return (
    <div ref={rootRef} className={cx(s.puzzle, tablet && s.tablet)} data-place-words data-step={step}>
      <div className={s.side}>
        <Slideshow frames={scene.frames} audioSrc={src} className={s.show} holdWhile={isPieceTag}>
          <button
            type="button"
            className={s.playBtn}
            onClick={() => {
              // Pause, or play the whole scene: either way a looping line is let go.
              setLoopLine(null);
              if (anyOn) audio.stop();
              else playScene(resumeAt.current, !done);
            }}
            aria-label={anyOn && engine.loading ? t('common.media.busy') : anyOn ? t('puzzles.place-words.pause') : t('puzzles.place-words.play')}
            aria-busy={(anyOn && engine.loading) || undefined}
            data-busy={(anyOn && engine.loading) || undefined}
          >
            {anyOn && engine.loading ? <Spinner size="sm" /> : <Icon name={anyOn ? 'pause' : 'play'} size={26} />}
          </button>
        </Slideshow>
        <SceneBar
          lines={scene.lines}
          durationMs={scene.audio.durationMs}
          src={src}
          compact
          loopLineId={loopLine}
          holdWhile={isPieceTag}
          onSeek={(ms) => {
            setLoopLine(null);
            resumeAt.current = ms;
            playScene(ms, !done);
          }}
        />
        <p className={s.prompt}>{t(done ? 'puzzles.place-words.done' : 'puzzles.place-words.prompt')}</p>
        {tablet && !done && renderTray()}
      </div>
      <ol className={s.dialogue}>{scene.lines.map(renderLine)}</ol>
      {/* On a phone the tray follows the dialogue and sticks to the bottom: in reach from every line. */}
      {!tablet && !done && renderTray()}
    </div>
  );

  function renderTray() {
    // What to do next, on the tray's edge (absolute: the layout never moves under the kid's finger).
    const call = selected ? t('puzzles.place-words.nowGap') : selGap ? t('puzzles.place-words.nowPiece') : null;
    return (
      <div className={s.trayWrap} data-tray-wrap>
        {tip && (
          <p className={s.tip} role="status" data-place-tip>
            {t('puzzles.place-words.tip')}
          </p>
        )}
        <div className={s.trayBox}>
          {call && (
            <span key={call} className={s.call} role="status" data-place-call>
              {call}
            </span>
          )}
          <div className={cx(s.tray, selGap && s.trayReady)} data-tray>
            {puzzle.tray.map((id, i) => {
              const u = findUnit(scene, id)?.unit;
              if (!u || state.placed.includes(id)) return null;
              const glow = glowPiece === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={cx(s.piece, selected === id && s.picked, glow && s.pieceGlow)}
                  style={{ '--i': i } as CSSProperties}
                  onClick={(e) => pick(id, e.currentTarget)}
                  data-piece={id}
                  aria-pressed={selected === id}
                >
                  <span>{u.fr}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
}
