/**
 * Single-administrator authentication.
 *
 * - The admin password is never stored: ADMIN_PASSWORD_HASH holds an scrypt
 *   hash (generate with `npm run hash-password`).
 * - Sessions are stateless: an HTTP-only cookie carries an expiry timestamp
 *   signed with SESSION_SECRET (HMAC-SHA256 via Web Crypto, so verification
 *   also works at build time and in any runtime the middleware lands in).
 * - Login attempts are rate limited per client IP (sliding window, in-memory
 *   per function instance) on top of a constant failure delay and scrypt's
 *   own cost. See README for the serverless caveat.
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'gcc_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SCRYPT_KEYLEN = 64;

export { SESSION_COOKIE };

function scryptAsync(password: string, salt: Buffer, keylen: number, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      { N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Produce an ADMIN_PASSWORD_HASH value: scrypt$N$r$p$salt$hash (base64). */
export async function hashPassword(password: string): Promise<string> {
  const cost = { N: 16384, r: 8, p: 1 };
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN, cost);
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const cost = { N: Number(nStr), r: Number(rStr), p: Number(pStr) };
  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), SCRYPT_KEYLEN, cost);
  return timingSafeEqual(actual, expected);
}

// ------------------------------------------------------------------ session

function b64url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64url');
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(sig);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${exp}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = await hmac(`v1.${exp}`, secret);
  return constantTimeEqual(parts[2], expected);
}

/**
 * Short-lived single-purpose tokens for dispatching the background worker,
 * which runs outside the Astro app and never sees the session cookie: the
 * authenticated dispatcher endpoint mints one and passes it in the request
 * body. Format v1.<scope>.<exp>.<sig> is distinct from session tokens
 * (which have three segments), so neither verifier accepts the other.
 */
export async function createScopedToken(
  scope: string,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): Promise<string> {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = `v1.${scope}.${exp}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyScopedToken(
  token: string | undefined,
  scope: string,
  secret: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || parts[1] !== scope) return false;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = await hmac(`v1.${scope}.${exp}`, secret);
  return constantTimeEqual(parts[3], expected);
}

export function sessionCookieOptions(maxAgeSeconds: number = SESSION_TTL_SECONDS) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: import.meta.env.PROD,
    maxAge: maxAgeSeconds,
  };
}

// ------------------------------------------------------------- rate limiting

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

/** Sliding-window limiter; returns true when the caller may attempt a login. */
export function allowLoginAttempt(ip: string, now = Date.now()): boolean {
  const windowStart = now - WINDOW_MS;
  const recent = (attempts.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  attempts.set(ip, recent);
  // Bound memory across many IPs.
  if (attempts.size > 10000) {
    for (const [key, times] of attempts) {
      if (times.every((t) => t <= windowStart)) attempts.delete(key);
    }
  }
  return true;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
