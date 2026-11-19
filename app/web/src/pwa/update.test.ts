import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTime, isClientTooOld, isNewerBuild, makeBuildId } from '../../../shared/build';
import { versionMedia } from '../api/content';
import { env, getUpdateState, holdUpdates, isChunkLoadError, isIdlePath, mayReload, maybeApply, noteServerBuild, outdated, resetUpdateForTests } from './update';

describe('build ids', () => {
  it('are made from the time and the commit, and ordered by time', () => {
    const a = makeBuildId(new Date('2026-11-14T15:30:00.123Z'), '2930ad2');
    expect(a).toBe('20261114T153000Z-2930ad2');
    expect(makeBuildId(new Date('2026-11-14T15:30:00Z'), 'abc1234', true)).toBe('20261114T153000Z-abc1234+');
    expect(buildTime(a)).toBe('20261114T153000Z');
    expect(isNewerBuild('20261114T153001Z-0000000', a)).toBe(true);
    expect(isNewerBuild(a, a)).toBe(false);
    expect(isNewerBuild('20261113T000000Z-ffffff0', a)).toBe(false);
  });

  it('never compare a dev build or garbage', () => {
    for (const x of ['dev', '', null, undefined, 'v2', '2026-11-14-abc', '20261114T153000Z-XYZ']) {
      expect(buildTime(x as string)).toBeNull();
      expect(isNewerBuild(x as string, '20260101T000000Z-1234567')).toBe(false);
      expect(isNewerBuild('20990101T000000Z-1234567', x as string)).toBe(false);
    }
  });

  it('apply the minimum-client rule only to real builds before the minimum', () => {
    expect(isClientTooOld('20261101T000000Z-1234567', '20261114T000000Z')).toBe(true);
    expect(isClientTooOld('20261114T000000Z-1234567', '20261114T000000Z')).toBe(false);
    expect(isClientTooOld('20261201T000000Z-1234567', '20261114T000000Z')).toBe(false);
    expect(isClientTooOld('20261101T000000Z-1234567', '')).toBe(false);
    expect(isClientTooOld(undefined, '20261114T000000Z')).toBe(false);
    expect(isClientTooOld('dev', '20261114T000000Z')).toBe(false);
    // A full build id works as the minimum too.
    expect(isClientTooOld('20261101T000000Z-1234567', '20261114T000000Z-89abcde')).toBe(true);
  });
});

describe('safe moments', () => {
  it('treats lists and pages as idle, activities as busy', () => {
    for (const p of ['/', '/episodes', '/episodes/s01e04', '/karaoke', '/profile', '/shop', '/friends', '/league', '/achievements', '/version', '/profile/']) expect(isIdlePath(p), p).toBe(true);
    for (const p of ['/practice/abc', '/chest/c1', '/karaoke/song-1', '/login', '/avatar', '/scene/s01e04-0016-0017', '/unlock', '/dev/ui']) expect(isIdlePath(p), p).toBe(false);
  });
});

describe('switching builds', () => {
  const reload = vi.fn();
  beforeEach(() => {
    resetUpdateForTests();
    sessionStorage.clear();
    reload.mockReset();
    env.reload = reload;
    env.burstMs = 10;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    history.replaceState(null, '', '/');
  });

  const MINE = '20261114T100000Z-aaaaaaa';
  const NEWER = '20261115T100000Z-bbbbbbb';

  it('ignores a server build when this client is a dev build', () => {
    env.build = 'dev';
    noteServerBuild(NEWER);
    expect(getUpdateState().phase).toBe('none');
  });

  it('ignores the same or an older build', () => {
    env.build = MINE;
    noteServerBuild(MINE);
    noteServerBuild('20261101T000000Z-ccccccc');
    expect(getUpdateState().phase).toBe('none');
  });

  it('switches on an idle screen after the NOUVEAU burst', () => {
    env.build = MINE;
    history.replaceState(null, '', '/episodes');
    noteServerBuild(NEWER);
    expect(getUpdateState().phase).toBe('applying');
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits during a practice and switches when the kid is back on an idle screen', () => {
    env.build = MINE;
    history.replaceState(null, '', '/practice/abc');
    noteServerBuild(NEWER);
    expect(getUpdateState()).toMatchObject({ phase: 'pending', serverBuild: NEWER });
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    history.replaceState(null, '', '/chest/c1');
    maybeApply();
    expect(getUpdateState().phase).toBe('pending');
    history.replaceState(null, '', '/');
    maybeApply();
    vi.advanceTimersByTime(20);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('goes back to waiting if the kid taps into a practice during the burst', () => {
    env.build = MINE;
    history.replaceState(null, '', '/');
    noteServerBuild(NEWER);
    expect(getUpdateState().phase).toBe('applying');
    history.replaceState(null, '', '/practice/x');
    vi.advanceTimersByTime(20);
    expect(reload).not.toHaveBeenCalled();
    expect(getUpdateState().phase).toBe('pending');
  });

  it('does not reload twice for the same build (an old copy is cached somewhere)', () => {
    env.build = MINE;
    history.replaceState(null, '', '/');
    noteServerBuild(NEWER);
    vi.advanceTimersByTime(20);
    expect(reload).toHaveBeenCalledTimes(1);
    resetUpdateForTests();
    env.reload = reload;
    env.burstMs = 10;
    noteServerBuild(NEWER); // the "reloaded" page still runs MINE
    vi.advanceTimersByTime(20);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getUpdateState().phase).toBe('none');
  });

  it('holds updates while a component asks', () => {
    env.build = MINE;
    history.replaceState(null, '', '/');
    const release = holdUpdates();
    noteServerBuild(NEWER);
    expect(getUpdateState().phase).toBe('pending');
    release();
    release(); // idempotent
    expect(getUpdateState().phase).toBe('applying');
  });

  it('reloads at once when the server says the client is outdated, but not in a loop', () => {
    history.replaceState(null, '', '/practice/abc');
    outdated('20261201T000000Z-1234567');
    expect(reload).toHaveBeenCalledTimes(1);
    outdated('20261201T000000Z-1234567');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getUpdateState().phase).toBe('stuck');
  });

  it('allows a reload again after the guard window or for another target', () => {
    const store = sessionStorage;
    store.setItem('frx.pwa.reload', JSON.stringify({ reason: 'update', target: 'B', at: 1000 }));
    expect(mayReload('update', 'B', 1000 + 30_000, store)).toBe(false);
    expect(mayReload('update', 'B', 1000 + 3 * 60_000, store)).toBe(true);
    expect(mayReload('update', 'C', 1000 + 30_000, store)).toBe(true);
    expect(mayReload('chunk', 'B', 1000 + 30_000, store)).toBe(true);
  });


  it('recognises chunk-load errors of every browser', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Home-1.js'))).toBe(true); // Chromium
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true); // Safari
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true); // Firefox
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true); // Vite
    expect(isChunkLoadError(new Error('scene-locked'))).toBe(false);
  });
});

describe('content versions in media URLs', () => {
  it('adds the content version to every /media/ path and nothing else', () => {
    const scene = {
      audio: { src: '/media/a/x.m4a', durationMs: 1 },
      frames: [{ t: 0, src: '/media/f/x/0.webp' }],
      thumb: '/media/f/x/1.webp',
      lines: [{ fr: 'Par Toutatis /media/', units: [{ drill: '/media/w/a.mp3' }] }],
      questions: [{ audio: '/media/q/abc.m4a', answers: [{ audio: '/media/q/def.m4a' }] }],
      already: '/media/a/y.m4a?v=old',
      other: '/data/scenes/x.json',
    };
    const out = versionMedia(scene, 'abc123');
    expect(out.audio.src).toBe('/media/a/x.m4a?v=abc123');
    expect(out.frames[0]!.src).toBe('/media/f/x/0.webp?v=abc123');
    expect(out.thumb).toBe('/media/f/x/1.webp?v=abc123');
    expect(out.lines[0]!.units[0]!.drill).toBe('/media/w/a.mp3?v=abc123');
    expect(out.questions[0]!.audio).toBe('/media/q/abc.m4a?v=abc123');
    expect(out.questions[0]!.answers[0]!.audio).toBe('/media/q/def.m4a?v=abc123');
    expect(out.lines[0]!.fr).toBe('Par Toutatis /media/');
    expect(out.already).toBe('/media/a/y.m4a?v=old');
    expect(out.other).toBe('/data/scenes/x.json');
    expect(versionMedia(scene, '')).toBe(scene);
  });
});
