// An honest play button (docs/app-games.md, "Loading media"): while the scene's audio is still on its
// way the scene player's button is busy, never "pause"; a tap then does not cancel the play.
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_SCENE } from '../../../shared/fixtures/scene';
import { t } from '../../../shared/i18n';
import { audio } from '../audio';
import { ScenePlayer } from './ScenePlayer';

class FakeContext {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  resume() {
    return Promise.resolve();
  }
}

afterEach(() => {
  audio.stop();
  vi.unstubAllGlobals();
});

describe('the scene player while its audio loads', () => {
  it('shows a busy button, not pause, and a tap does not cancel the play', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', () => new Promise(() => {})); // the audio never arrives in this test
    const scene = { ...FIXTURE_SCENE, audio: { ...FIXTURE_SCENE.audio, src: '/media/a/busy-test.m4a' } };
    const { container } = render(<ScenePlayer scene={scene} autoPlay />);
    const button = container.querySelector<HTMLButtonElement>('[data-scene-play]')!;
    expect(audio.getState()).toMatchObject({ playing: true, loading: true });
    expect(button.getAttribute('data-busy')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe(t('common.media.busy'));
    expect(button.getAttribute('aria-label')).not.toBe(t('scene.player.pause'));
    await act(async () => {
      fireEvent.click(button);
    });
    expect(audio.getState()).toMatchObject({ playing: true, loading: true });
  });
});
