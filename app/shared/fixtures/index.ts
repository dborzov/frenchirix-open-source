// Fixtures for tests and for the client under VITE_FIXTURES=1.
//  FIXTURE_SCENE    one real, complete Scene (s01e04-0016-0017)
//  FIXTURE_INDEX    a ContentIndex of all 203 scenes (summaries from the database) around it
//  FIXTURE_SONG     a Song built from the fixture scene
//  fixtureSceneFor  a stand-in Scene for any id of the index (the fixture scene's lines under that id's summary)
//  FIXTURE_PLAYER   a kid four days in (see player.ts)
import type { ContentIndex, Scene, SceneSummary, Song } from '../content';
import { FIXTURE_EPISODES, FIXTURE_SCENE_ROWS } from './index-data';
import { FIXTURE_SCENE } from './scene';

export { FIXTURE_SCENE } from './scene';
export { FIXTURE_PLAYER, FIXTURE_TODAY } from './player';

const summaryFields = (s: Scene): SceneSummary => ({
  id: s.id,
  episode: s.episode,
  order: s.order,
  startMs: s.startMs,
  durationMs: s.durationMs,
  kind: s.kind,
  titleFr: s.titleFr,
  titleEn: s.titleEn,
  score: s.score,
  difficulty: s.difficulty,
  thumb: s.thumb,
  lineCount: s.lineCount,
  wordCount: s.wordCount,
});

const summaries: SceneSummary[] = /*#__PURE__*/ FIXTURE_SCENE_ROWS.map(
  ([id, episode, order, startMs, durationMs, kind, title, score, difficulty, lineCount, wordCount]) =>
    id === FIXTURE_SCENE.id
      ? summaryFields(FIXTURE_SCENE)
      : { id, episode, order, startMs, durationMs, kind, titleFr: title, titleEn: title, score, difficulty, thumb: `/media/f/${id}/0.webp`, lineCount, wordCount },
);

export const FIXTURE_SONG: Song = {
  id: 'romans-world',
  episode: 's01e04',
  titleFr: 'Le monde des Romains',
  titleEn: 'The Romans’ world',
  audio: FIXTURE_SCENE.audio,
  frames: FIXTURE_SCENE.frames,
  lines: FIXTURE_SCENE.lines,
};

export const FIXTURE_INDEX: ContentIndex = {
  version: 'fixture',
  episodes: FIXTURE_EPISODES,
  scenes: summaries,
  songs: [
    {
      id: FIXTURE_SONG.id,
      episode: FIXTURE_SONG.episode,
      titleFr: FIXTURE_SONG.titleFr,
      titleEn: FIXTURE_SONG.titleEn,
      durationMs: FIXTURE_SONG.audio.durationMs,
      thumb: FIXTURE_SCENE.thumb,
    },
  ],
  bank: {
    lines: [
      { fr: 'Par Toutatis, le ciel va nous tomber sur la tête !', en: 'By Toutatis, the sky is going to fall on our heads!' },
      { fr: 'Ils sont fous, ces Romains.', en: 'They are crazy, these Romans.' },
      { fr: 'Je ne suis pas gros !', en: 'I am not fat!' },
      { fr: 'On va manger du sanglier ce soir.', en: 'We are going to eat wild boar tonight.' },
      { fr: 'Donne-moi la potion magique.', en: 'Give me the magic potion.' },
    ],
    units: [
      { fr: 'le sanglier', en: 'the wild boar' },
      { fr: 'la potion', en: 'the potion' },
      { fr: 'le chef', en: 'the chief' },
      { fr: 'ils sont fous', en: 'they are crazy' },
      { fr: 'le village', en: 'the village' },
      { fr: 'un menhir', en: 'a standing stone' },
    ],
  },
};

const summaryById = new Map(/*#__PURE__*/ summaries.map((s) => [s.id, s]));

/** The fixture scene's content under the summary of `id`, so every scene of the index opens in fixture mode. */
export function fixtureSceneFor(id: string): Scene | null {
  if (id === FIXTURE_SCENE.id) return FIXTURE_SCENE;
  const s = summaryById.get(id);
  if (!s) return null;
  return { ...FIXTURE_SCENE, ...s, lineCount: FIXTURE_SCENE.lineCount, wordCount: FIXTURE_SCENE.wordCount };
}
