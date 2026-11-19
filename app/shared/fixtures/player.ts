// A kid four days in: started on 2026-11-10, played three days in a row, has not played yet today.
// Six scenes unlocked at different levels (some due today, one overdue, one not yet due), one
// unopened chest, two items, one achievement. Today's quests: three due practices, the choose quest
// (locked until those are passed; its candidates drawn, nothing chosen yet) and one bronze place.
import type { ChestKind, PlayerState, Quest } from '../api';
import { DEFAULT_AVATAR } from '../catalog/types';

function quest(index: number, kind: Quest['kind'], chest: ChestKind, over: Partial<Quest>): Quest {
  return {
    index, kind, round: 0, extra: false, chest, done: false, chestId: null,
    sceneId: null, level: 0, reason: null, practice: null, chosen: 0, target: 0, locked: false, waitingFor: [],
    ...over,
  };
}

export const FIXTURE_TODAY = '2026-11-13';

export const FIXTURE_PLAYER: PlayerState = {
  profile: {
    id: 'u_fixture01',
    name: 'chinchilla-farceur',
    nameChosen: false,
    pin: '427',
    language: 'fr',
    avatar: { ...DEFAULT_AVATAR, worn: { hat: 'winged-helmet' } },
    speak: true,
    timeZone: 'America/Toronto',
    createdDay: '2026-11-10',
  },
  currencies: { xp: 184, sesterces: 47, potions: 1 },
  streak: {
    count: 3,
    best: 3,
    lastDay: '2026-11-12',
    doneToday: false,
    fullToday: false,
    week: [
      { day: '2026-11-07', kind: 'none' },
      { day: '2026-11-08', kind: 'none' },
      { day: '2026-11-09', kind: 'none' },
      { day: '2026-11-10', kind: 'full' },
      { day: '2026-11-11', kind: 'light' },
      { day: '2026-11-12', kind: 'full' },
      { day: '2026-11-13', kind: 'none' },
    ],
  },
  skillEstimate: 1.8,
  progress: {
    's01e04-0016-0017': { level: 2, dueDay: '2026-11-13', passes: 3, unlockedDay: '2026-11-10', views: 2, lastPassDay: '2026-11-11' },
    's01e04-0010-0011': { level: 2, dueDay: '2026-11-13', passes: 2, unlockedDay: '2026-11-10', views: 0, lastPassDay: '2026-11-11' },
    's01e01-0004-0008': { level: 2, dueDay: '2026-11-14', passes: 2, unlockedDay: '2026-11-11', views: 1, lastPassDay: '2026-11-12' },
    's01e02-0074-0076': { level: 1, dueDay: '2026-11-12', passes: 1, unlockedDay: '2026-11-11', views: 0, lastPassDay: '2026-11-11' },
    's01e03-0042-0046': { level: 1, dueDay: '2026-11-13', passes: 1, unlockedDay: '2026-11-12', views: 0, lastPassDay: '2026-11-12' },
    's01e05-0017-0022': { level: 0, dueDay: null, passes: 0, unlockedDay: '2026-11-12', views: 1, lastPassDay: null },
  },
  inventory: { 'winged-helmet': 1, 'squeaky-lyre': 1 },
  chests: [{ id: 'c_fixture01', kind: 'silver', source: 'quest', earnedDay: '2026-11-12' }],
  achievements: { 'first-lesson': { earnedDay: '2026-11-10', seen: true } },
  stats: {
    practicesFinished: 5,
    perfectPractices: 1,
    questsDone: 9,
    puzzlesFinished: 61,
    streak: 3,
    bestStreak: 3,
    daysPractised: 3,
    scenesUnlocked: 6,
    scenesViewed: 4,
    scenesBronze: 5,
    scenesSilver: 3,
    linesSpoken: 9,
    loopsHeard: 143,
    chestsOpened: 5,
    itemsOwned: 2,
    xp: 184,
  },
  daily: {
    day: '2026-11-13',
    candidates: [
      { sceneId: 's01e02-0003-0008', unlocked: false },
      { sceneId: 's01e01-0053-0058', unlocked: false },
      { sceneId: 's01e04-0018-0019', unlocked: false },
      { sceneId: 's01e05-0023-0029', unlocked: false },
      { sceneId: 's01e03-0029-0034', unlocked: false },
      { sceneId: 's01e01-0067-0071', unlocked: false },
      { sceneId: 's01e01-0335-0339', unlocked: false },
      { sceneId: 's01e03-0214-0219', unlocked: false },
      { sceneId: 's01e04-0129-0133', unlocked: false },
      { sceneId: 's01e05-0336-0339', unlocked: false },
    ],
    unlocksLeft: 3,
    quests: [
      quest(0, 'practice', 'wood', { sceneId: 's01e02-0074-0076', level: 2, reason: 'due' }),
      quest(1, 'practice', 'wood', { sceneId: 's01e04-0010-0011', level: 3, reason: 'due' }),
      quest(2, 'practice', 'wood', { sceneId: 's01e04-0016-0017', level: 3, reason: 'due' }),
      quest(3, 'choose', 'silver', { target: 3, locked: true, waitingFor: [0, 1, 2] }),
      quest(4, 'practice', 'gold', { level: 1, reason: 'new' }),
    ],
    questsDone: false,
    round: 0,
    choose: 3,
    doMore: false,
    dueSceneIds: ['s01e02-0074-0076', 's01e04-0016-0017', 's01e04-0010-0011', 's01e03-0042-0046', 's01e05-0017-0022'],
  },
  league: { week: '2026-11-09', tier: 0, weekXp: 184, rank: 4, groupSize: 12 },
  inboxUnread: 1,
  today: FIXTURE_TODAY,
  practices: {},
  recordings: {},
};
