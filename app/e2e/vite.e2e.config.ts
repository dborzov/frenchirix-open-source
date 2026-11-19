// The client build for the end-to-end worker specs (meta-server.ts): the app's own Vite config, without
// copying public/. meta-server copies public/ itself, skipping files that appear or vanish meanwhile
// (the export hard-links question clips into public/media/q while the suite may be running; the TTS
// script writes them in work/tts-q and work/app-media/q).
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import base from '../vite.config';

export default defineConfig((env: ConfigEnv) => {
  const b = (typeof base === 'function' ? base(env) : base) as UserConfig;
  return mergeConfig(b, { build: { copyPublicDir: false } });
});
