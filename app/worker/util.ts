// Small helpers shared by the routes: errors, ids, crypto, the clock, cookies.
import type { Context } from 'hono';
import type { ApiError, ApiErrorCode } from '../shared/api';
import type { AppEnv, Env } from './env';

export type Ctx = Context<AppEnv>;

/** Thrown anywhere in a handler; turned into an ApiError response by the app's error handler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message?: string,
    readonly retryAfterS?: number,
  ) {
    super(message ?? code);
  }
}

export const fail = (status: number, code: ApiErrorCode, message?: string, retryAfterS?: number): never => {
  throw new HttpError(status, code, message, retryAfterS);
};

export function errorBody(e: HttpError): ApiError {
  const body: ApiError = { error: e.code };
  if (e.message && e.message !== e.code) body.message = e.message;
  if (e.retryAfterS !== undefined) body.retryAfterS = e.retryAfterS;
  return body;
}

/** The JSON body of the request, or bad-request. */
export async function jsonBody<T = Record<string, unknown>>(c: Ctx): Promise<T> {
  try {
    const v = await c.req.json();
    if (v && typeof v === 'object') return v as T;
  } catch {
    // fall through
  }
  return fail(400, 'bad-request', 'expected a JSON object');
}

// ---------------------------------------------------------------------------------------------
// Ids and randomness

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function randomId(prefix: string, n = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

/** A uniform float in [0, 1) from the crypto generator. */
export function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
}

export function randomPin(): string {
  return String(Math.floor(cryptoRandom() * 1000)).padStart(3, '0');
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))));
}

/** Constant-time string comparison (on SHA-256 digests, so lengths do not leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da.charCodeAt(i) ^ db.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------------------------
// Clock and test hooks

export const testMode = (env: Env): boolean => !!env.TEST_MODE;

/** Now, in ms. In TEST_MODE an `x-test-now` header (ISO instant) replaces the clock. */
export function nowMs(c: Ctx): number {
  if (testMode(c.env)) {
    const h = c.req.header('x-test-now');
    if (h) {
      const t = Date.parse(h);
      if (!Number.isNaN(t)) return t;
    }
  }
  return Date.now();
}

export function clientIp(c: Ctx): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export const isHttps = (c: Ctx): boolean => new URL(c.req.url).protocol === 'https:';

export function getCookie(c: Ctx, name: string): string | null {
  const header = c.req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookieHeader(c: Ctx, name: string, value: string, maxAgeS: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAgeS}`, 'HttpOnly', 'SameSite=Lax'];
  if (isHttps(c)) parts.push('Secure');
  return parts.join('; ');
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Clamp an untrusted number to an integer in [lo, hi]; NaN and non-numbers give lo. */
export function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : lo;
  return Math.max(lo, Math.min(hi, n));
}
