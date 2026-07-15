import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getStore } from '@netlify/blobs';
import { getDb, tables } from '../../../../../lib/db';
import { fireBuildHook } from '../../../../../lib/build-hook';
import { getPiece, isPublished, notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const db = getDb();
  const images = await db
    .select({ blobKey: tables.pieceImages.blobKey })
    .from(tables.pieceImages)
    .where(eq(tables.pieceImages.pieceId, id));

  // Child rows cascade with the piece row.
  await db.delete(tables.pieces).where(eq(tables.pieces.id, id));

  try {
    const store = getStore('images');
    await Promise.all(images.map((img) => store.delete(img.blobKey)));
  } catch (err) {
    console.error('[admin] blob cleanup failed after piece delete:', err);
  }

  if (isPublished(piece)) await fireBuildHook(`Deleted: ${piece.accession}`);
  return redirect('/admin/pieces?saved=deleted', 303);
};
