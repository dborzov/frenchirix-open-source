import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { fakeVoiceWav } from './e2e/fakeVoice';

// End-to-end tests drive the system Chromium (never download a browser: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).
//   E2E_TARGET=fixtures (default)  vite dev server with VITE_FIXTURES=1 on WEB_PORT: UI only, no worker
//   E2E_TARGET=worker              `npm run build` then wrangler dev on WORKER_PORT with local D1 in PERSIST_DIR
// Set E2E_BASE_URL to test a server you started yourself.
const target = process.env.E2E_TARGET ?? 'fixtures';
// Not Vite's usual 5173: on a shared machine another project's Vite may sit there, and the specs would
// silently run against it. E2E_REUSE_SERVER=1 reuses a server already on the port.
const webPort = Number(process.env.WEB_PORT ?? 5197);
const reuse = process.env.E2E_REUSE_SERVER === '1';
const workerPort = Number(process.env.WORKER_PORT ?? 8787);
const port = target === 'worker' ? workerPort : webPort;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

const chromium = {
  ...devices['Desktop Chrome'],
  // A fake microphone that is granted without a prompt and sounds like a voice to the client's voice gate
  // (e2e/fakeVoice.ts), for the speaking puzzle types; and a fake audio output (Web Audio still runs, at
  // 44.1 kHz): with the desktop's real sound server, closing a context that had played audio hung
  // Chromium for minutes on a loaded machine.
  launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fakeVoiceWav()}`, '--disable-audio-output'] },
};

// Every spec but smoke.spec.ts plays real scenes: without the content bundle (a clone without content)
// only the smoke spec runs, and this says so.
const hasBundle = existsSync(new URL('./public/data/index.json', import.meta.url));
if (!hasBundle) console.warn('e2e: no content bundle in app/public/data, so only smoke.spec.ts runs; the other specs play real scenes (build the bundle from the repository root with  .venv/bin/frenchirix export-app)');

/** The specs the upright iPad project runs: layout and reachability, and the journey through the quests (about 4 minutes). */
const IPAD_PORTRAIT_SPECS = ['screens.spec.ts', 'contrast.spec.ts', 'puzzles.spec.ts', 'journey.worker.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  testIgnore: hasBundle ? [] : /^(?!.*smoke\.spec\.ts$).*/,
  // E2E_OUTPUT_DIR: somewhere else than the shared test-results/, which another run in the same tree wipes when it starts.
  outputDir: process.env.E2E_OUTPUT_DIR ?? './test-results',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...chromium, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false } },
    { name: 'tablet', use: { ...chromium, viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true } },
    // An upright iPad (iPad Air, 820x1180), for the specs that check layout and reachability and the
    // journey: the user prioritises iPad and phone, and the tablet project above is landscape only.
    { name: 'ipad-portrait', testMatch: IPAD_PORTRAIT_SPECS, use: { ...chromium, viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : target === 'worker'
      ? { command: 'npm run build && npm run db:migrate && npm run dev:worker', url: `${baseURL}/api/health`, reuseExistingServer: reuse, timeout: 180_000 }
      : { command: 'npm run dev:web', url: baseURL, reuseExistingServer: reuse, timeout: 60_000, env: { VITE_FIXTURES: '1', WEB_PORT: String(webPort) } },
});
