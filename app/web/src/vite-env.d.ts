/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1': use the in-memory fixture client and fall back to shared fixtures for content. */
  readonly VITE_FIXTURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
