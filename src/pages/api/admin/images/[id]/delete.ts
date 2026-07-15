import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getStore } from '@netlify/blobs';
import { getDb, tables } from '../../../../../lib/db';
import { getPiece, isPublished, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();

  const db = getDb();
  const [image] = await db.select().from(tables.pieceImages).where(eq(tables.pieceImages.id, id)).limit(1);
  if (!image) return notFound();
  const piece = await getPiece(image.pieceId);

  await db.delete(tables.pieceImages).where(eq(tables.pieceImages.id, id));
  try {
    await getStore('images').delete(image.blobKey);
  } catch (err) {
    console.error('[admin] blob delete failed:', err);
  }

  if (piece) await rebuildIfPublic(isPublished(piece), `Image removed: ${piece.accession}`);
  return redirect(`/admin/pieces/${image.pieceId}?saved=image-deleted`, 303);
};
