import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { getPiece, isPublished, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const db = getDb();
  const [row] = await db.select().from(tables.acquisitions).where(eq(tables.acquisitions.id, id)).limit(1);
  if (!row) return notFound();

  await db.delete(tables.acquisitions).where(eq(tables.acquisitions.id, id));

  if (row.isPublicProvenance) {
    const piece = await getPiece(row.pieceId);
    if (piece) await rebuildIfPublic(isPublished(piece), `Provenance removed: ${piece.accession}`);
  }
  return redirect(`/admin/pieces/${row.pieceId}?saved=acquisition-deleted`, 303);
};
