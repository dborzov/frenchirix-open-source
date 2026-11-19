// One command for local development: `npm run dev` (in app/), then open http://localhost:8787.
//
//  - the client: Vite on WEB_PORT (8787), with live reload, serving public/ (the bundle and media);
//  - the Worker: wrangler dev on WORKER_PORT (8788), which Vite proxies /api and /gate to;
//    LOCAL_DEV=1 (no school gate, no admin password, localhost only) and TEST_MODE off;
//    the AI binding is remote, so speech recognition is real Workers AI (wrangler must be logged in);
//  - its own D1 state in PERSIST_DIR (.wrangler/dev-state), migrated on start.
// Ctrl-C stops both.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webPort = process.env.WEB_PORT ?? '8787';
const workerPort = process.env.WORKER_PORT ?? '8788';
const state = process.env.PERSIST_DIR ?? '.wrangler/dev-state';
const bin = (name) => resolve(app, 'node_modules/.bin', name);

// wrangler.jsonc names dist/ as the Worker's assets; Vite serves the client, but the folder must exist.
if (!existsSync(resolve(app, 'dist/index.html'))) {
  console.log('[dev] no dist/ yet: building once');
  if (spawnSync(bin('vite'), ['build'], { cwd: app, stdio: 'inherit' }).status !== 0) process.exit(1);
}
console.log(`[dev] migrating the local database in ${state}`);
const mig = spawnSync(bin('wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], { cwd: app, stdio: 'inherit', env: { ...process.env, CI: '1' } });
if (mig.status !== 0) process.exit(1);

const children = [];
function run(tag, cmd, args, env = {}) {
  const child = spawn(cmd, args, { cwd: app, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(`[${tag}] ${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[${tag}] exited (${code}); stopping`);
    stop(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('worker', bin('wrangler'), [
  'dev', '--port', workerPort, '--inspector-port', String(Number(workerPort) + 1000), '--persist-to', state,
  '--var', 'LOCAL_DEV:1', '--var', 'TEST_MODE:', '--show-interactive-dev-session=false',
]);
run('web', bin('vite'), [], { WEB_PORT: webPort, WORKER_PORT: workerPort });
console.log(`[dev] open http://localhost:${webPort} (no passwords; /dev is open)`);
