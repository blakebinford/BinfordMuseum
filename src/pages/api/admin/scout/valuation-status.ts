import type { APIRoute } from 'astro';
import { isScoutRunId, readAiStatusKey, scoutStatusKey } from '../../../../lib/ai-status';

export const prerender = false;

/** Poll target for a scout run's valuation research. */
export const GET: APIRoute = async ({ url }) => {
  const runId = url.searchParams.get('run');
  if (!isScoutRunId(runId)) {
    return new Response(JSON.stringify({ error: 'bad-run' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const status = await readAiStatusKey(scoutStatusKey(runId)).catch(() => null);
  return new Response(
    JSON.stringify({
      state: status?.state ?? null,
      error: status?.error ?? null,
      result: status?.state === 'done' ? (status.result ?? null) : null,
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
