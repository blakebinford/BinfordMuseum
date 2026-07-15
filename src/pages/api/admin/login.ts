import type { APIRoute } from 'astro';
import {
  SESSION_COOKIE,
  allowLoginAttempt,
  clientIp,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from '../../../lib/auth';

export const prerender = false;

const FAILURE_DELAY_MS = 500;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const secret = process.env.SESSION_SECRET;
  const storedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!secret || !storedHash) {
    console.error('[auth] SESSION_SECRET or ADMIN_PASSWORD_HASH is not set.');
    return redirect('/admin/login?error=config', 303);
  }

  if (!allowLoginAttempt(clientIp(request))) {
    return redirect('/admin/login?error=rate', 303);
  }

  const form = await request.formData().catch(() => null);
  const password = form?.get('password');

  const valid = typeof password === 'string' && password.length > 0 && (await verifyPassword(password, storedHash));

  if (!valid) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return redirect('/admin/login?error=credentials', 303);
  }

  cookies.set(SESSION_COOKIE, await createSessionToken(secret), sessionCookieOptions());
  return redirect('/admin', 303);
};
