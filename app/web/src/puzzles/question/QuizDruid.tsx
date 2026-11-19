// The quiz-show host: the app's druid (pwa/druid.ts, the same drawing as the icon) with a white robe
// and a host's microphone, and three faces: neutral (his sly half-closed eye), delighted (eye shut
// in a grin, brow up, sparkles) and baffled (eye wide open, brow shot up, "?!" marks, a sweat drop).
// Our own drawing, thick ink and flat colour, 512 x 640 box.
import type { CSSProperties } from 'react';
import { DRUID, GREEN, GREEN_DARK, INK, RED, WHITE, YELLOW, type Shape } from '../../pwa/druid';
import { cx } from '../../ui';
import s from './Question.module.css';

export type DruidMood = 'neutral' | 'delighted' | 'baffled';

// DRUID is painted back to front; its last four shapes are the eye (white, pupil, lid) and the brow.
const FACE_FROM = DRUID.length - 4;
const BASE = DRUID.slice(0, FACE_FROM);
const NEUTRAL_FACE = DRUID.slice(FACE_FROM);

const BROW = 'M250 202 C266 176 304 166 330 178 L356 164 L344 186 L366 190 L340 202 C314 198 282 204 252 214 Z';

function P({ sh }: { sh: Shape }) {
  return <path d={sh.d} fill={sh.fill} stroke={sh.sw > 0 ? (sh.stroke ?? INK) : undefined} strokeWidth={sh.sw > 0 ? sh.sw : undefined} strokeLinejoin="round" strokeLinecap={sh.cap} />;
}

function Face({ mood }: { mood: DruidMood }) {
  if (mood === 'delighted') {
    return (
      <g>
        {/* eye shut in a grin, a rosy cheek, the brow lifted */}
        <path d="M270 236 C282 214 306 214 318 234" fill="none" stroke={INK} strokeWidth={10} strokeLinecap="round" />
        <ellipse cx="300" cy="262" rx="16" ry="9" fill={RED} opacity={0.55} />
        <path d={BROW} fill={GREEN_DARK} stroke={INK} strokeWidth={8} strokeLinejoin="round" transform="translate(0 -22) rotate(-6 300 190)" />
      </g>
    );
  }
  if (mood === 'baffled') {
    return (
      <g>
        <circle cx="296" cy="226" r="24" fill={WHITE} stroke={INK} strokeWidth={7} />
        <circle cx="300" cy="228" r="6" fill={INK} />
        <path d={BROW} fill={GREEN_DARK} stroke={INK} strokeWidth={8} strokeLinejoin="round" transform="translate(-4 -34) rotate(10 300 190)" />
        {/* a sweat drop at the back of the dome */}
        <path d="M196 150 C186 166 184 178 194 182 C204 184 206 170 196 150 Z" fill="#7fd3ff" stroke={INK} strokeWidth={5} />
      </g>
    );
  }
  return (
    <g>
      {NEUTRAL_FACE.map((sh, i) => (
        <P key={i} sh={sh} />
      ))}
    </g>
  );
}

export function QuizDruid({ mood, talking, className, style }: { mood: DruidMood; talking?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 512 640" className={cx(s.druid, s[`druid-${mood}`], talking && s.druidTalking, className)} style={style} aria-hidden data-druid={mood}>
      {/* the robe: white, with a red cloak over the shoulder */}
      <path d="M120 640 C120 520 170 420 240 396 L340 410 C420 440 456 540 456 640 Z" fill={WHITE} stroke={INK} strokeWidth={11} strokeLinejoin="round" />
      <path d="M120 640 C124 540 160 450 214 410 C200 480 196 560 210 640 Z" fill={RED} stroke={INK} strokeWidth={9} strokeLinejoin="round" />
      <g className={s.druidHead}>
        {BASE.map((sh, i) => (
          <P key={i} sh={sh} />
        ))}
        <Face mood={mood} />
      </g>
      {/* the host's microphone in a green hand, held up to the beard */}
      <g className={s.druidMic}>
        <path d="M420 560 L452 446" stroke={INK} strokeWidth={16} strokeLinecap="round" />
        <rect x="430" y="404" width="52" height="64" rx="22" fill="#555" stroke={INK} strokeWidth={9} transform="rotate(16 456 436)" />
        <path d="M438 420 h40 M436 436 h40 M436 452 h40" stroke="#888" strokeWidth={4} transform="rotate(16 456 436)" />
        <ellipse cx="420" cy="540" rx="34" ry="28" fill={GREEN} stroke={INK} strokeWidth={9} />
      </g>
      {mood === 'baffled' && (
        <g className={s.druidMarks}>
          <text x="380" y="120" fontFamily="Bangers, Impact, sans-serif" fontSize="120" fill={YELLOW} stroke={INK} strokeWidth={7} paintOrder="stroke">
            ?!
          </text>
        </g>
      )}
      {mood === 'delighted' && (
        <g className={s.druidMarks} fill={YELLOW} stroke={INK} strokeWidth={6} strokeLinejoin="miter">
          <path d="M400 70 l14 34 l36 4 l-28 22 l10 36 l-32 -20 l-32 20 l10 -36 l-28 -22 l36 -4 Z" />
          <path d="M90 130 l9 22 l23 3 l-18 14 l6 23 l-20 -13 l-20 13 l6 -23 l-18 -14 l23 -3 Z" />
        </g>
      )}
    </svg>
  );
}
