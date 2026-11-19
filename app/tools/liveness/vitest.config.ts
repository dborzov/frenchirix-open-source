// The liveness explorer's own Vitest config (`npm run check:liveness` runs it through run.ts), so that
// `npm test` stays fast: one file, web/src/testing/liveness.explore.tsx, in happy-dom.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const appDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: appDir,
  test: {
    name: 'liveness',
    environment: 'happy-dom',
    include: ['web/src/testing/**/*.explore.tsx'],
    env: { LIVENESS_APP_DIR: appDir },
    // A puzzle's unhandled rejection is a finding (the explorer records it), not a failure of the check.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
