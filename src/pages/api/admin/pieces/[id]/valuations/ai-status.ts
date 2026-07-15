import type { APIRoute } from 'astro';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../../lib/db';
import { readAiStatus } from '../../../../../../lib/ai-status';
import { getPiece, notFound, parseId } from '../../../../../../lib/admin-api';

export const prerender = false;

/**
 * Poll target for background AI valuation runs. Returns the worker's run
 * state plus the id of the newest ai_research valuation for the piece; the
 * client detects completion by that id changing, which makes the inserted
 * row (not the status record) the source of truth.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const [status, [latest]] = await Promise.all([
    readAiStatus(id).catch(() => null),
    getDb()
      .select({ id: tables.valuations.id, valuedOn: tables.valuations.valuedOn })
      .from(tables.valuations)
      .where(and(eq(tables.valuations.pieceId, id), eq(tables.valuations.method, 'ai_research')))
      .orderBy(desc(tables.valuations.id))
      .limit(1),
  ]);

  return new Response(
    JSON.stringify({
      state: status?.state ?? 'none',
      error: status?.error ?? null,
      latestId: latest?.id ?? null,
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
