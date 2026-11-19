import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

// Three projects:
//  shared  pure logic, Node            shared/**/*.test.ts, tools/**/*.test.ts
//  web     React components, happy-dom web/src/**/*.test.{ts,tsx}
//  worker  inside workerd with D1      worker/**/*.test.ts (bindings from wrangler.jsonc, isolated per test)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['shared/**/*.test.ts', 'tools/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['web/src/testing/setup.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            // Never reach Cloudflare from tests: the AI binding is remote-only, so it is unavailable here (mock it).
            remoteBindings: false,
            miniflare: {
              // Test-only values; the tests read the passwords back from env (worker/testing.ts).
              bindings: { TEST_MODE: '1', SESSION_SECRET: 'test-secret', GATE_PASSWORD: 'testgate', ADMIN_PASSWORD: 'testadmin' },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['worker/**/*.test.ts'],
        },
      },
    ],
  },
});
