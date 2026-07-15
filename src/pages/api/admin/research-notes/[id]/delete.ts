import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const db = getDb();
  const [row] = await db.select().from(tables.researchNotes).where(eq(tables.researchNotes.id, id)).limit(1);
  if (!row) return notFound();
  await db.delete(tables.researchNotes).where(eq(tables.researchNotes.id, id));
  return redirect(`/admin/pieces/${row.pieceId}?saved=note-deleted`, 303);
};
