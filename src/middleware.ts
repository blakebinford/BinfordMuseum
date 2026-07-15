import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, verifySessionToken } from './lib/auth';

const LOGIN_PATH = '/admin/login';
const OPEN_PATHS = new Set([LOGIN_PATH, '/api/admin/login']);

function isGuarded(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/');
}

/**
 * Guards every /admin page and /api/admin endpoint. These routes are all
 * on-demand rendered (prerender = false), so this check runs on every
 * request; public prerendered routes pass through untouched.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (!isGuarded(pathname)) {
    return next();
  }

  const token = context.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token, process.env.SESSION_SECRET);
  context.locals.isAdmin = authed;

  if (!authed && !OPEN_PATHS.has(pathname)) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect(LOGIN_PATH, 303);
  }

  // Origin check on mutating admin requests (belt and suspenders on top of
  // the SameSite=Strict session cookie).
  if (authed && context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    const origin = context.request.headers.get('origin');
    if (origin && origin !== context.url.origin) {
      return new Response(JSON.stringify({ error: 'Cross-origin request rejected' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const response = await next();
  // Admin surfaces are never indexed (pages also carry a noindex meta tag).
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
});
