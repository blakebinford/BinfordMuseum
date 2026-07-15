import type { APIRoute } from 'astro';
import { and, eq, or } from 'drizzle-orm';
import { getDb, tables } from '../../../../../../lib/db';
import { AiError, aiConfigured } from '../../../../../../lib/ai';
import { detectAndStoreConnections } from '../../../../../../lib/connections';
import { getPiece, notFound, parseId } from '../../../../../../lib/admin-api';

export const prerender = false;

/**
 * Re-run connection detection for one piece against the current catalog.
 * Pending AI proposals for the piece are replaced; approved links and
 * owner-created links are untouched (and block re-proposals of their pair).
 */
export const POST: APIRoute = async ({ params, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  if (!aiConfigured()) return redirect(`/admin/pieces/${id}?error=ai-config`, 303);

  const { pieceLinks } = tables;
  await getDb()
    .delete(pieceLinks)
    .where(
      and(
        or(eq(pieceLinks.fromPieceId, id), eq(pieceLinks.toPieceId, id)),
        eq(pieceLinks.createdBy, 'ai'),
        eq(pieceLinks.approved, false),
      ),
    );

  try {
    await detectAndStoreConnections(id);
    return redirect(`/admin/pieces/${id}?saved=rescan`, 303);
  } catch (err) {
    const code = err instanceof AiError && err.kind === 'config' ? 'ai-config' : 'ai-failed';
    if (!(err instanceof AiError)) console.error('[links] rescan failed:', err);
    return redirect(`/admin/pieces/${id}?error=${code}`, 303);
  }
};
