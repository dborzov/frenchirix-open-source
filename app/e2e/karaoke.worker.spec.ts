// Karaoke recordings through the real interface and the real Worker (TEST_MODE: the page's
// ?transcript= goes as x-test-transcript and stands in for Whisper; without it the local Worker has no
// Workers AI, so the check fails with 503 as Whisper being down would). The fake microphone sings
// (e2e/fakeVoice.ts). The journey: the karaoke's own first-time notice, singing while the song plays
// once, the check, hearing it over the song, keeping it; the song then plays with the recording, also
// after a reload and in Home's card; erasing it. Then the other paths: a rude take refused, a take with
// no voice never sent and the deaf notice, a refused or missing microphone, the check failing and the
// same singing sent again, today's limit and singing too long to send, throwing singing away while it
// is checked and leaving without choosing, a failed keep and a failed erase, the back button during a
// take, the words being sung in view at every size, a take that ends with the song and lands where it
// was sung (a digital loopback), a recording slow to load or missing.
// Screenshots of every state in E2E_SHOTS (default test-results/karaoke).
import { mkdirSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { audioState, guard, settled } from './drive';
import { api, expect, test, type MetaServer } from './meta-server';

test.use({ devBuild: true, trace: 'off' });
test.describe.configure({ timeout: 240_000 });

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/karaoke';
mkdirSync(SHOTS, { recursive: true });

/** A screenshot once the screen settled (`settle` false while recording: the countdown is a song-long animation). */
async function shot(page: Page, project: string, name: string, settle = true): Promise<void> {
  if (settle) await settled(page).catch(() => {});
  // Two frames after a scroll into view (a capture in the scroll's own frame showed the page shifted under a black band).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` });
}

const studio = (page: Page) => page.locator('[data-studio]');
const TAKE = /\/api\/karaoke\/[^/]+\/take/;

/** Every microphone stream the page opens is counted, to check none is left live. */
async function watchMic(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return;
    const streams: MediaStream[] = [];
    const w = window as unknown as { __micLive: () => number; __micOpened: () => number; __gum?: (c?: MediaStreamConstraints) => Promise<MediaStream> };
    w.__micLive = () => streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
    w.__micOpened = () => streams.length;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await (w.__gum ?? orig)(c);
      streams.push(s);
      return s;
    };
  });
}
const micLive = (page: Page) => page.evaluate(() => (window as unknown as { __micLive: () => number }).__micLive());
const micOpened = (page: Page) => page.evaluate(() => (window as unknown as { __micOpened: () => number }).__micOpened());

/** The karaoke's first-time notice already seen. */
async function noticeSeen(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => localStorage.setItem('frx.karaoke.intro', '1'));
}

/**
 * Plays the song of a player (`scope`: the song's screen, or Home's card): a tap on something inert
 * unlocks audio and the song starts by itself; if it does not, its play button. (Tapping the "tap to
 * sing" burst itself races the start, which removes it under the finger.)
 */
async function startSong(page: Page, songId: string, scope = page.locator(`[data-karaoke="${songId}"]`), inert = page.locator('h1').first()): Promise<void> {
  await expect(scope.locator('[data-karaoke-toggle]')).toBeVisible({ timeout: 20_000 });
  await inert.click({ force: true });
  await expect.poll(() => songPlaying(page, songId), { timeout: 3000 }).toBe(true).catch(async () => {
    await scope.locator('[data-karaoke-toggle]').click();
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
  });
}

async function songPlaying(page: Page, songId: string): Promise<boolean> {
  const st = await audioState(page);
  return st.tag === `song:${songId}` && st.playing;
}

/** Opens a song's screen and starts the song. */
async function openSong(page: Page, server: MetaServer, songId: string, transcript?: string): Promise<void> {
  await page.goto(`${server.base}/karaoke/${songId}${transcript !== undefined ? `?transcript=${encodeURIComponent(transcript)}` : ''}`);
  await expect(studio(page)).toHaveAttribute('data-studio', 'idle', { timeout: 20_000 });
  await startSong(page, songId);
}

const setTranscript = (page: Page, text: string) => page.evaluate((x) => history.replaceState(null, '', `${location.pathname}?transcript=${encodeURIComponent(x)}`), text);

/** Starts a take (through the first-time notice when it shows) and waits for the microphone to listen. */
async function startTake(page: Page): Promise<void> {
  await page.locator('[data-studio-record]').click();
  await expect(page.locator('[data-mic="listening"], [data-mic-ok]').first()).toBeVisible({ timeout: 15_000 });
  const ok = page.locator('[data-mic-ok]');
  if (await ok.isVisible()) await ok.click();
  await expect(page.locator('[data-mic="listening"]')).toBeVisible({ timeout: 15_000 });
}

/** Records `ms` of singing and taps "done". */
async function sing(page: Page, ms = 3000): Promise<void> {
  await startTake(page);
  await page.waitForTimeout(ms); // the fake microphone sings meanwhile
  await page.locator('[data-studio-record]').click(); // "done"
}

test.describe('karaoke recordings', () => {
  test('the first-time notice, singing, the check, listening, keeping; the song then plays with the recording, after a reload and in Home’s card; erase it', async ({ newKidPage, server }, info) => {
    const project = info.project.name;
    const { ctx, page } = await newKidPage();
    await watchMic(ctx);
    // A kid who met a speaking puzzle first still gets the karaoke's own notice (its singing is kept).
    await ctx.addInitScript(() => localStorage.setItem('frx.mic.intro', '1'));
    const gg = guard(page);
    // The song Home's card plays today: the recording is made for it.
    await page.goto(`${server.base}/`);
    const card = page.locator('[data-karaoke-card]');
    await expect(card).not.toHaveAttribute('data-karaoke-card', 'loading', { timeout: 20_000 });
    const songId = (await card.getAttribute('data-karaoke-card'))!;
    await expect(card.locator('[data-studio]')).toHaveCount(0); // no studio, no recorder, in the card

    await openSong(page, server, songId, 'la la la, je chante avec la chanson');
    await expect(page.locator('[data-studio-mine]')).toHaveCount(0);
    await shot(page, project, '1-idle');

    // The karaoke's own notice: « Retour à la chanson » opens no microphone and the song plays on.
    await page.locator('[data-studio-record]').click();
    await expect(page.locator('[data-mic-intro]')).toBeVisible();
    await shot(page, project, '2-notice');
    await page.locator('[data-mic-skip]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    expect(await micOpened(page)).toBe(0);
    await expect.poll(() => songPlaying(page, songId)).toBe(true);

    // Recording: the song starts over from its beginning, once, with nothing over it; the player's controls rest.
    await page.locator('[data-studio-record]').click();
    await page.locator('[data-mic-ok]').click();
    await expect(page.locator('[data-mic="listening"]')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await audioState(page)).playing).toBe(true);
    expect(await audioState(page)).toMatchObject({ tag: `song:${songId}`, loop: false, overlay: null });
    await expect(page.locator('[data-karaoke-toggle]')).toBeDisabled();
    await expect(page.locator('[data-countdown]')).toBeVisible();
    expect(await micLive(page)).toBe(1);
    await page.waitForTimeout(2500);
    await shot(page, project, '3-recording', false);

    // Done: the microphone goes off; checked (held a moment to see it) while the song goes on; then heard over the song.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(TAKE, async (route) => {
      await held;
      await route.continue();
    });
    await page.locator('[data-studio-record]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'checking');
    await expect(page.locator('[data-mic="thinking"]')).toBeVisible();
    await expect.poll(() => micLive(page)).toBe(0);
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
    await shot(page, project, '4-checking', false);
    release();
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen', { timeout: 20_000 });
    await page.unroute(TAKE);
    await expect.poll(async () => (await audioState(page)).overlay ?? '').toMatch(/^blob:/);
    expect((await audioState(page)).loop).toBe(true);
    // Nothing is kept yet.
    expect((await api(page, 'GET', '/api/me')).json.state.recordings).toEqual({});
    await shot(page, project, '5-listen');

    // Keep it: it becomes the song's recording.
    await page.locator('[data-studio-keep]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    await expect(page.locator('[data-toast="karaoke-kept"]')).toBeVisible();
    const rec = (await api(page, 'GET', '/api/me')).json.state.recordings[songId];
    expect(rec).toMatchObject({ songId, url: `/api/karaoke/audio/${rec.id}.wav` });
    expect(rec.durationMs).toBeGreaterThan(1500);
    expect(rec.durationMs).toBeLessThan(5000);
    await expect(studio(page)).toHaveAttribute('data-studio-recording', rec.id);
    await expect(page.locator('[data-karaoke-voice]')).toBeVisible();
    await page.locator('[data-toast="karaoke-kept"]').click(); // dismiss
    await shot(page, project, '6-idle-with-recording');
    // The server serves the WAV to this kid.
    const wav = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const b = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get('content-type'), riff: String.fromCharCode(...b.slice(0, 4)), bytes: b.length };
    }, rec.url);
    expect(wav).toMatchObject({ status: 200, type: 'audio/wav', riff: 'RIFF' });
    expect(Math.abs(wav.bytes - 44 - (rec.durationMs / 1000) * 32000)).toBeLessThan(200);

    // After a reload the song plays with the recording from the server, through loops and seeks.
    await openSong(page, server, songId);
    await expect.poll(async () => (await audioState(page)).overlay).toBe(rec.url);
    await page.locator('[data-karaoke-restart]').click();
    await expect.poll(async () => (await audioState(page)).overlay).toBe(rec.url);

    // Home's card plays it too.
    await page.goto(`${server.base}/`);
    await startSong(page, songId, card, page.locator('[data-home-hello]'));
    await expect.poll(async () => (await audioState(page)).overlay, { timeout: 15_000 }).toBe(rec.url);
    await expect(card.locator('[data-karaoke-voice]')).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(page, project, '7-home-card');

    // Erase it, after a confirmation (no toast over its title); the song goes on without the voice.
    await openSong(page, server, songId);
    await page.locator('[data-studio-remove]').click();
    await expect(page.locator('[data-studio-confirm]')).toBeVisible();
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    await shot(page, project, '8-erase-confirm');
    await page.locator('[data-studio-remove-keep]').click();
    await expect(studio(page)).toHaveAttribute('data-studio-recording', rec.id);
    await page.locator('[data-studio-remove]').click();
    await page.locator('[data-studio-remove-go]').click();
    await expect(studio(page)).toHaveAttribute('data-studio-recording', '');
    await expect.poll(async () => (await audioState(page)).overlay ?? null).toBeNull();
    expect((await api(page, 'GET', '/api/me')).json.state.recordings).toEqual({});
    gg.allow(/\/api\/karaoke\/audio\//);
    expect(await page.evaluate(async (url) => (await fetch(url)).status, rec.url)).toBe(404);
    gg.check('karaoke journey');
  });

  test('a rude take is refused, nothing is kept, the song plays again; recording again works', async ({ newKidPage, server }, info) => {
    const project = info.project.name;
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    const gg = guard(page);
    const songId = 's01e03-madame-arbre';
    await openSong(page, server, songId, 'Madame Arbre, putain, tout va bien');
    await sing(page);
    await expect(studio(page)).toHaveAttribute('data-studio', 'refused', { timeout: 20_000 });
    await expect(page.locator('[data-studio-note="refused"]')).toBeVisible();
    expect(await page.locator('[data-studio-note]').innerText()).not.toMatch(/putain/i);
    expect((await api(page, 'GET', '/api/me')).json.state.recordings).toEqual({});
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
    await shot(page, project, '9-refused');
    await setTranscript(page, 'tout va bien');
    await sing(page);
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen', { timeout: 20_000 });
    await page.locator('[data-studio-drop]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    await expect.poll(async () => (await audioState(page)).overlay ?? null).toBeNull();
    expect((await api(page, 'GET', '/api/me')).json.state.recordings).toEqual({});
    gg.check('refused');
  });

  test('no voice: never sent, the song plays again; three in a row: the deaf notice; a refused microphone', async ({ newKidPage, server }, info) => {
    const project = info.project.name;
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    // A microphone that hears nothing at all.
    await ctx.addInitScript(() => {
      (window as unknown as { __gum: () => Promise<MediaStream> }).__gum = async () => new AudioContext().createMediaStreamDestination().stream;
    });
    await watchMic(ctx);
    const gg = guard(page);
    const sent: string[] = [];
    page.on('request', (r) => r.url().includes('/api/karaoke/') && sent.push(r.url()));
    const songId = 's01e05-monde-romain-reprise';
    await openSong(page, server, songId, 'la la la');
    await sing(page, 2500);
    await expect(studio(page)).toHaveAttribute('data-studio', 'silent', { timeout: 15_000 });
    await expect(page.locator('[data-studio-note="silent"]')).toBeVisible();
    expect(sent).toEqual([]);
    expect(await page.locator('[data-mic]').getAttribute('data-mic')).toBe('idle'); // the microphone is off
    expect(await micLive(page)).toBe(0);
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
    await shot(page, project, '10-no-voice');
    // Two more: the microphone's own notice, and back to the song.
    await sing(page, 1500);
    await expect(studio(page)).toHaveAttribute('data-studio', 'silent', { timeout: 15_000 });
    await sing(page, 1500);
    await expect(page.locator('[data-mic-denied="deaf"]')).toBeVisible({ timeout: 15_000 });
    await shot(page, project, '11-deaf');
    await page.locator('[data-mic-skip]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    expect(sent).toEqual([]);

    // The microphone refused: a plain notice, and the way back to the song.
    await page.evaluate(() => {
      (window as unknown as { __gum: () => Promise<MediaStream> }).__gum = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await page.locator('[data-studio-record]').click();
    await expect(page.locator('[data-mic-denied="denied"]')).toBeVisible({ timeout: 10_000 });
    await shot(page, project, '12-mic-denied');
    await page.locator('[data-mic-skip]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
    gg.check('no voice');
  });

  test('a browser with no microphone: nothing on arrival, nothing logged; after a tap a plain message and the way back', async ({ newKidPage, server }) => {
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }));
    const gg = guard(page);
    const micLogs = () => page.evaluate(() => (window as unknown as { __frxLog: () => { kind: string }[] }).__frxLog().filter((e) => e.kind === 'mic').length);
    await page.goto(`${server.base}/`);
    await expect(page.locator('[data-karaoke-card] [data-karaoke]')).toBeVisible({ timeout: 20_000 });
    const songId = 's01e04-monde-romain';
    await openSong(page, server, songId);
    await expect(page.locator('[data-mic-denied]')).toHaveCount(0);
    expect(await micLogs()).toBe(0);
    await page.locator('[data-studio-record]').click();
    await expect(page.locator('[data-mic-denied="unsupported"]')).toBeVisible();
    expect(await micLogs()).toBe(1);
    await page.locator('[data-mic-skip]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    await expect(page.locator('[data-mic-denied]')).toHaveCount(0);
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
    gg.check('no microphone');
  });

  test('the check fails (Whisper down): the error panel, the same singing sent again; leaving it unchosen throws it away', async ({ newKidPage, server }, info) => {
    const project = info.project.name;
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    await watchMic(ctx);
    const gg = guard(page);
    const songId = 's01e04-monde-romain';
    await openSong(page, server, songId); // no ?transcript=: the local Worker has no Whisper
    gg.allow(TAKE);
    await sing(page);
    await expect(studio(page)).toHaveAttribute('data-studio', 'failed', { timeout: 20_000 });
    const panel = page.locator('[data-error-panel]');
    await expect(panel.locator('[data-error-retry]')).toBeVisible();
    expect(await panel.innerText()).toContain('FRX-ERR server 503 POST /api/karaoke/');
    await shot(page, project, '13-failed');
    // Whisper is back: « Réessayer » sends the same singing; the microphone does not open again.
    const opened = await micOpened(page);
    await setTranscript(page, "C'est un monde romain");
    await panel.locator('[data-error-retry]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen', { timeout: 20_000 });
    expect(await micOpened(page)).toBe(opened);
    // Leaving without choosing (the tab bar): the server's copy is thrown away.
    const dropped = page.waitForRequest((r) => r.method() === 'DELETE' && TAKE.test(r.url()));
    await page.locator('[data-nav="/"]').first().click();
    await dropped;
    await expect.poll(async () => (await api(page, 'GET', '/api/me')).json.state.recordings).toEqual({});
    gg.check('failed, then left');
  });

  test('today’s limit and singing too long to send: no « Réessayer », back to the song; throwing singing away while it is checked', async ({ newKidPage, server }, info) => {
    const project = info.project.name;
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    const gg = guard(page);
    gg.allow(TAKE);
    const songId = 's01e03-madame-arbre';
    await openSong(page, server, songId, 'la la la');
    for (const [status, code] of [[429, 'rate-limited'], [413, 'too-big']] as const) {
      await page.route(TAKE, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: code }) }));
      await sing(page, 1500);
      await expect(studio(page)).toHaveAttribute('data-studio', 'failed', { timeout: 15_000 });
      const panel = page.locator('[data-error-panel]');
      await expect(panel).toHaveAttribute('data-error-kind', 'client');
      await expect(panel.locator('[data-error-retry]')).toHaveCount(0);
      await shot(page, project, `14-failed-${status}`);
      await panel.locator('[data-studio-drop]').click();
      await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
      await expect.poll(() => songPlaying(page, songId)).toBe(true);
      await page.unroute(TAKE);
    }
    // Checking held: « Je le jette » abandons it and the server's copy is thrown away.
    await page.route(TAKE, async (route) => {
      if (route.request().method() === 'POST') return; // never answered
      await route.continue();
    });
    await sing(page, 1500);
    await expect(studio(page)).toHaveAttribute('data-studio', 'checking');
    const dropped = page.waitForRequest((r) => r.method() === 'DELETE' && TAKE.test(r.url()));
    await page.locator('[data-studio-drop]').click();
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    await dropped;
    await expect.poll(() => songPlaying(page, songId)).toBe(true);
    await page.unroute(TAKE);
    gg.check('limits');
  });

  test('a failed keep keeps the singing to keep again; a failed erase keeps the recording', async ({ newKidPage, server }) => {
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    const gg = guard(page);
    const songId = 's01e03-madame-arbre';
    await openSong(page, server, songId, 'la la la');
    await sing(page, 1500);
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen', { timeout: 15_000 });
    const SAVE = /\/api\/karaoke\/[^/]+\/save/;
    gg.allow(SAVE);
    await page.route(SAVE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) }));
    await page.locator('[data-studio-keep]').click();
    await expect(page.locator('[data-toast]').filter({ hasText: 'FRX-ERR' })).toBeVisible();
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen');
    await page.unroute(SAVE);
    await page.locator('[data-studio-keep]').click();
    await expect(studio(page)).toHaveAttribute('data-studio-recording', /^k_/);
    const recId = await studio(page).getAttribute('data-studio-recording');
    const ERASE = /\/api\/karaoke\/[^/]+\/recording/;
    gg.allow(ERASE);
    await page.route(ERASE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) }));
    await page.locator('[data-studio-remove]').click();
    await page.locator('[data-studio-remove-go]').click();
    await expect(page.locator('[data-toast]').filter({ hasText: 'FRX-ERR' })).toBeVisible();
    await expect(page.locator('[data-studio-confirm]')).toBeVisible(); // the dialog stays, to try again or leave it
    await page.locator('[data-studio-remove-keep]').click();
    await expect(studio(page)).toHaveAttribute('data-studio-recording', recId!);
    expect((await api(page, 'GET', '/api/me')).json.state.recordings[songId].id).toBe(recId);
    gg.check('failed keep and erase');
  });

  test('the back button and a history navigation during a take release the microphone', async ({ newKidPage, server }) => {
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    await watchMic(ctx);
    const gg = guard(page);
    await openSong(page, server, 's01e03-madame-arbre', 'la la');
    // To another song through the picker, then a take there.
    for (const back of ['button', 'history'] as const) {
      await page.locator('[role="tablist"] button').filter({ hasText: /monde romain$/i }).first().click();
      await expect(page.locator('[data-karaoke="s01e04-monde-romain"]')).toBeVisible({ timeout: 15_000 });
      await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
      await startTake(page);
      expect(await micLive(page)).toBe(1);
      if (back === 'button') await page.goBack();
      else await page.evaluate(() => history.back()); // what an iPad's swipe does
      await expect(page.locator('[data-karaoke="s01e03-madame-arbre"]')).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => micLive(page)).toBe(0);
      await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
      await expect(page.locator('[data-mic="listening"]')).toHaveCount(0);
    }
    gg.check('back during a take');
  });

  test('the words being sung stay in view during a take, at every size', async ({ newKidPage, server }, info) => {
    test.skip(info.project.name !== 'phone', 'one run walks every size');
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    const gg = guard(page);
    for (const [width, height] of [[390, 844], [375, 667], [768, 1024], [1024, 768], [1180, 820], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      await openSong(page, server, 's01e04-monde-romain', 'la la');
      await startTake(page);
      for (const wait of [700, 3000]) {
        await page.waitForTimeout(wait);
        const r = await page.evaluate(() => {
          const row = document.querySelector('[data-row="current"]')!.getBoundingClientRect();
          const mic = document.querySelector('[data-mic]')!.getBoundingClientRect();
          const top = document.querySelector('header')!.getBoundingClientRect().bottom;
          const nav = [...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect()).find((b) => b.top > innerHeight / 2 && b.width > innerWidth / 2);
          const bottom = nav ? nav.top : innerHeight;
          return { row: [row.top, row.bottom], mic: [mic.top, mic.bottom], top, bottom };
        });
        const where = `${width}x${height} ${JSON.stringify(r)}`;
        expect(r.row[0], where).toBeGreaterThanOrEqual(r.top - 1);
        expect(r.row[1], where).toBeLessThanOrEqual(r.bottom);
        expect(r.mic[0], where).toBeGreaterThanOrEqual(r.top - 1);
        expect(r.mic[1], where).toBeLessThanOrEqual(r.bottom);
      }
      await shot(page, `size-${width}x${height}`, 'take', false);
      await page.locator('[data-mic-pause]').click();
      await expect(studio(page)).toHaveAttribute('data-studio', 'idle');
    }
    gg.check('sizes');
  });

  test('a take that ends with the song lands on the song where it was sung (a digital loopback)', async ({ newKidPage, server }, info) => {
    test.skip(info.project.name !== 'phone', 'the 29 s song, once');
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    // The "microphone" is the engine's own output: the take holds the song exactly as it was heard.
    await ctx.addInitScript(() => {
      const C = window.AudioContext;
      const ctxs: AudioContext[] = [];
      window.AudioContext = class extends C {
        constructor(...a: ConstructorParameters<typeof AudioContext>) {
          super(...a);
          ctxs.push(this);
        }
      } as typeof AudioContext;
      let loop: MediaStreamAudioDestinationNode | null = null;
      const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
      (AudioNode.prototype as unknown as { connect: unknown }).connect = function (this: AudioNode, dst: unknown, ...rest: unknown[]) {
        const r = connect.call(this, dst, ...rest);
        if (dst instanceof AudioDestinationNode && this.context === ctxs[0]) {
          loop ??= ctxs[0]!.createMediaStreamDestination();
          connect.call(this, loop);
        }
        return r;
      };
      navigator.mediaDevices.getUserMedia = async () => loop!.stream;
    });
    const gg = guard(page);
    const songId = 's01e03-madame-arbre';
    let body: Buffer | null = null;
    let offset = -1;
    await page.route(TAKE, async (route) => {
      body = route.request().postDataBuffer();
      offset = Number(new URL(route.request().url()).searchParams.get('offset'));
      await route.continue();
    });
    await openSong(page, server, songId, 'Madame Arbre, tout va bien');
    await startTake(page);
    // No tap: the song's end ends the take.
    await expect(studio(page)).toHaveAttribute('data-studio', /checking|listen/, { timeout: 60_000 });
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen', { timeout: 20_000 });
    expect(body).not.toBeNull();
    // Where the take sits on the song: cross-correlation of 2 s of it against the song, within ±150 ms.
    const lagMs = await page.evaluate(
      async ({ wav, src, offsetMs }) => {
        const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
        const take = new Int16Array(bytes.buffer.slice(44));
        const song = await new OfflineAudioContext(1, 16000 * 31, 16000).decodeAudioData(await (await fetch(src)).arrayBuffer());
        const ch = song.numberOfChannels > 1 ? song.getChannelData(0).map((x, i) => (x + song.getChannelData(1)[i]!) / 2) : song.getChannelData(0);
        const start = 16000 * 6;
        const n = 16000 * 2;
        const base = Math.round((offsetMs / 1000) * 16000) + start;
        let best = 0;
        let bestLag = 0;
        for (let lag = -2400; lag <= 2400; lag++) {
          let sum = 0;
          for (let i = 0; i < n; i += 2) sum += (take[start + i]! / 32768) * (ch[base + lag + i] ?? 0);
          if (sum > best) {
            best = sum;
            bestLag = lag;
          }
        }
        return bestLag / 16;
      },
      { wav: (body as unknown as Buffer).toString('base64'), src: (await audioState(page)).src!, offsetMs: offset },
    );
    console.log(`karaoke loopback: the voice sits ${lagMs.toFixed(1)} ms from where it was sung (offset ${offset} ms)`);
    expect(Math.abs(lagMs)).toBeLessThan(50);
    gg.check('loopback');
  });

  test('a recording slow to load never holds the song back, and its stamp waits for it; a missing one shows none', async ({ newKidPage, server }) => {
    const { ctx, page } = await newKidPage();
    await noticeSeen(ctx);
    const gg = guard(page);
    const songId = 's01e03-madame-arbre';
    await openSong(page, server, songId, 'la la');
    await sing(page, 1500);
    await expect(studio(page)).toHaveAttribute('data-studio', 'listen', { timeout: 15_000 });
    await page.locator('[data-studio-keep]').click();
    await expect(studio(page)).toHaveAttribute('data-studio-recording', /^k_/);
    const AUDIO = /\/api\/karaoke\/audio\//;
    // Slow: the song starts at once without the voice and without the stamp; both come with the voice.
    await page.route(AUDIO, async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });
    await page.goto(`${server.base}/karaoke/${songId}`);
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle', { timeout: 20_000 });
    await page.locator('h1').first().click({ force: true });
    // The song is decoded and plays within 2.5 s, while the voice is still on its way (4 s).
    await expect.poll(async () => { const st = await audioState(page); return st.tag === `song:${songId}` && st.playing && !st.loading; }, { timeout: 2500 }).toBe(true);
    expect((await audioState(page)).overlay ?? null).toBeNull();
    await expect(page.locator('[data-karaoke-voice]')).toHaveCount(0);
    await expect.poll(async () => (await audioState(page)).overlay, { timeout: 10_000 }).toMatch(AUDIO);
    await expect(page.locator('[data-karaoke-voice]')).toBeVisible();
    await page.unroute(AUDIO);
    // Missing: the song plays alone, and no stamp says otherwise.
    gg.allow(AUDIO);
    await page.route(AUDIO, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not-found"}' }));
    await page.goto(`${server.base}/karaoke/${songId}`);
    await expect(studio(page)).toHaveAttribute('data-studio', 'idle', { timeout: 20_000 });
    await startSong(page, songId);
    await page.waitForTimeout(1500);
    expect((await audioState(page)).overlay ?? null).toBeNull();
    await expect(page.locator('[data-karaoke-voice]')).toHaveCount(0);
    await page.unroute(AUDIO);
    gg.check('slow and missing recording');
  });
});
