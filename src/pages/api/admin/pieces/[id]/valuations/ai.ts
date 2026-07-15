import type { APIRoute } from 'astro';
import { createScopedToken } from '../../../../../../lib/auth';
import { aiConfigured } from '../../../../../../lib/ai';
import { readAiStatus, writeAiStatus } from '../../../../../../lib/ai-status';
import { getPiece, notFound, parseId } from '../../../../../../lib/admin-api';

export const prerender = false;

const STALE_RUN_MS = 12 * 60 * 1000;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Dispatcher for background AI valuation research. This endpoint runs inside
 * the Astro app, so the admin middleware has already authenticated the
 * session; it owns the one-run-per-piece guard, records the `running`
 * status, and invokes the background function with a short-lived signed run
 * token in the body. The worker trusts only that token, never headers, so
 * nothing depends on what Netlify's async invocation queue forwards.
 */
export const POST: APIRoute = async ({ params, url }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const secret = process.env.SESSION_SECRET;
  if (!aiConfigured() || !secret) return json(503, { error: 'ai-config' });

  const existing = await readAiStatus(id).catch(() => null);
  if (existing?.state === 'running' && Date.now() - Date.parse(existing.startedAt) < STALE_RUN_MS) {
    return json(200, { started: true, already: true });
  }

  await writeAiStatus(id, { state: 'running', startedAt: new Date().toISOString() });

  const token = await createScopedToken(`ai-valuation:${id}`, secret, 15 * 60);
  const workerUrl = process.env.AI_VALUATION_WORKER_URL || new URL('/background/ai-valuation', url.origin).href;

  try {
    const dispatch = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pieceId: id, token }),
      signal: AbortSignal.timeout(10_000),
    });
    // Netlify acknowledges a background invocation with 202 before running it.
    if (!dispatch.ok && dispatch.status !== 202) {
      throw new Error(`worker dispatch returned ${dispatch.status}`);
    }
  } catch (err) {
    console.error('[ai-valuation] dispatch failed:', err);
    await writeAiStatus(id, {
      state: 'failed',
      error: 'ai-failed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
    return json(502, { error: 'ai-failed' });
  }

  return json(200, { started: true });
};
