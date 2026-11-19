// Setup for the `web` test project (vitest.config.ts): unmount every rendered component after each
// test. Vitest runs without globals, so Testing Library does not do it by itself; without it, timers
// of a mounted component can fire after the test file's page is torn down ("document is not defined").
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
