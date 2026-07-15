import type { APIRoute } from 'astro';
import { and, eq, ne } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { parsePieceForm } from '../../../../../lib/piece-form';
import { getPiece, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const values = parsePieceForm(await request.formData());
  if (!values) return redirect(`/admin/pieces/${id}?error=invalid`, 303);

  const db = getDb();
  const clash = await db
    .select({ id: tables.pieces.id })
    .from(tables.pieces)
    .where(and(eq(tables.pieces.accession, values.accession), ne(tables.pieces.id, id)))
    .limit(1);
  if (clash.length > 0) return redirect(`/admin/pieces/${id}?error=accession`, 303);

  await db
    .update(tables.pieces)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tables.pieces.id, id));

  await rebuildIfPublic(piece.isPublic, `Piece updated: ${values.accession}`);
  return redirect(`/admin/pieces/${id}?saved=piece`, 303);
};
