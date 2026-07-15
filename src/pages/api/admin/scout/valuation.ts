import type { APIRoute } from 'astro';
import { createScopedToken } from '../../../../lib/auth';
import { aiConfigured } from '../../../../lib/ai';
import { isScoutRunId, readAiStatusKey, scoutStatusKey, writeAiStatusKey } from '../../../../lib/ai-status';
import { sanitizeIdentification } from '../../../../lib/scout';

export const prerender = false;

const STALE_RUN_MS = 12 * 60 * 1000;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Dispatch valuation research for a scout run to the background worker
 * (same research as piece valuations; the 60-second synchronous limit rules
 * out running it inline). The result lands in the run's status record; the
 * scout page polls /api/admin/scout/valuation-status.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const secret = process.env.SESSION_SECRET;
  if (!aiConfigured() || !secret) return json(503, { error: 'ai-config' });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isScoutRunId(body.runId)) return json(400, { error: 'bad-run' });
  const runId = body.runId;
  const identification = sanitizeIdentification(body.identification);

  const statusKey = scoutStatusKey(runId);
  const existing = await readAiStatusKey(statusKey).catch(() => null);
  if (existing?.state === 'running' && Date.now() - Date.parse(existing.startedAt) < STALE_RUN_MS) {
    return json(200, { started: true, already: true });
  }

  await writeAiStatusKey(statusKey, { state: 'running', startedAt: new Date().toISOString() });

  const token = await createScopedToken(`ai-valuation:scout-${runId}`, secret, 15 * 60);
  const workerUrl = process.env.AI_VALUATION_WORKER_URL || new URL('/background/ai-valuation', url.origin).href;

  try {
    const dispatch = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scout: { runId, piece: identification }, token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!dispatch.ok && dispatch.status !== 202) {
      throw new Error(`worker dispatch returned ${dispatch.status}`);
    }
  } catch (err) {
    console.error('[scout] valuation dispatch failed:', err);
    await writeAiStatusKey(statusKey, {
      state: 'failed',
      error: 'ai-failed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
    return json(502, { error: 'ai-failed' });
  }

  return json(200, { started: true });
};
