import type { APIRoute } from 'astro';
import { eq, inArray } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { fireBuildHook } from '../../../../../lib/build-hook';
import { notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

/**
 * Approve a connection. Approved links appear on both pieces' public pages
 * as related pieces with the reason as caption, so approving a link between
 * two published pieces rebuilds the site.
 */
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const db = getDb();
  const { pieceLinks, pieces } = tables;

  const [link] = await db.select().from(pieceLinks).where(eq(pieceLinks.id, id)).limit(1);
  if (!link) return notFound();

  await db.update(pieceLinks).set({ approved: true, updatedAt: new Date() }).where(eq(pieceLinks.id, id));

  const ends = await db
    .select({ id: pieces.id, status: pieces.status, accession: pieces.accession })
    .from(pieces)
    .where(inArray(pieces.id, [link.fromPieceId, link.toPieceId]));
  if (ends.length === 2 && ends.every((p) => p.status === 'published')) {
    await fireBuildHook(`Connection approved: ${ends[0].accession} and ${ends[1].accession}`);
  }

  // Send the owner back to whichever piece page they acted from.
  const form = await request.formData().catch(() => null);
  const fromRaw = form?.get('piece');
  const backTo = typeof fromRaw === 'string' && parseId(fromRaw) ? Number(fromRaw) : link.fromPieceId;
  return redirect(`/admin/pieces/${backTo}?saved=link-approved`, 303);
};
