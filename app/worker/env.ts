// The Worker's bindings (wrangler.jsonc) and secrets (.dev.vars locally, `wrangler secret put` in production).
export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  GATE_PASSWORD: string; // the site's shared password (secret)
  TEST_MODE: string; // non-empty only in tests and local dev: enables x-test-now and x-test-transcript
  SESSION_SECRET: string;
  ADMIN_PASSWORD: string; // /dev in production (secret); not real security
  LOCAL_DEV?: string; // on the command line only (tools/dev.mjs): no passwords on localhost (worker/admin.ts); deploy.sh refuses it in wrangler.jsonc
}

/** Hono generics for this app: `new Hono<AppEnv>()`, `Context<AppEnv>`. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** The signed-in kid's id, set by requireSession. */
    userId: string;
  };
}
