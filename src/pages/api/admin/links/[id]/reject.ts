import type { APIRoute } from 'astro';
import { eq, inArray } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { fireBuildHook } from '../../../../../lib/build-hook';
import { notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

/**
 * Reject (or remove) a connection. Removing an approved link between two
 * published pieces changes their public pages, so the rebuild hook fires;
 * rejecting a pending proposal changes nothing public.
 */
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const db = getDb();
  const { pieceLinks, pieces } = tables;

  const [link] = await db.select().from(pieceLinks).where(eq(pieceLinks.id, id)).limit(1);
  if (!link) return notFound();

  await db.delete(pieceLinks).where(eq(pieceLinks.id, id));

  if (link.approved) {
    const ends = await db
      .select({ id: pieces.id, status: pieces.status, accession: pieces.accession })
      .from(pieces)
      .where(inArray(pieces.id, [link.fromPieceId, link.toPieceId]));
    if (ends.length === 2 && ends.every((p) => p.status === 'published')) {
      await fireBuildHook(`Connection removed: ${ends[0].accession} and ${ends[1].accession}`);
    }
  }

  // Send the owner back to whichever piece page they acted from.
  const form = await request.formData().catch(() => null);
  const fromRaw = form?.get('piece');
  const backTo = typeof fromRaw === 'string' && parseId(fromRaw) ? Number(fromRaw) : link.fromPieceId;
  return redirect(`/admin/pieces/${backTo}?saved=${link.approved ? 'link-removed' : 'link-rejected'}`, 303);
};
