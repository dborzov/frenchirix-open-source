import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { makeBuildId } from './shared/build';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const webPort = Number(process.env.WEB_PORT ?? 5173);
const workerPort = Number(process.env.WORKER_PORT ?? 8787);
const worker = { target: `http://localhost:${workerPort}`, changeOrigin: false };

/**
 * The build id (`<UTC time>-<commit>`, shared/build.ts): compiled into the client as __FRX_BUILD__ and
 * written to dist/build.json, which the Worker reads, so a deploy's client and Worker agree. The dev
 * server uses 'dev', which never triggers an update. FRX_BUILD overrides it (tests).
 */
function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: here('.'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
function buildIdentity(command: 'build' | 'serve'): string {
  if (process.env.FRX_BUILD) return process.env.FRX_BUILD;
  if (command === 'serve') return 'dev';
  return makeBuildId(new Date(), git(['rev-parse', '--short=7', 'HEAD']), git(['status', '--porcelain', '--untracked-files=no']) !== '');
}
function buildJson(id: string): Plugin {
  return {
    name: 'frx-build-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ build: id }) + '\n' });
    },
  };
}

export default defineConfig(({ command }) => {
  const build = buildIdentity(command);
  return {
    root: here('./web'),
    // public/ holds the exported bundle (public/data, public/media); vite serves it in dev and copies it into dist/.
    publicDir: here('./public'),
    envDir: here('.'),
    plugins: [react(), buildJson(build)],
    define: { __FRX_BUILD__: JSON.stringify(build) },
    server: {
      port: webPort,
      strictPort: true,
      // The API and the gate live in the worker (`npm run dev:worker`). Not needed with VITE_FIXTURES=1.
      proxy: { '/api': worker, '/gate': worker },
    },
    preview: { port: webPort, strictPort: true },
    build: {
      outDir: here('./dist'),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 1500,
    },
  };
});
