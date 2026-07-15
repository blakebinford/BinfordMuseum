import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../lib/db';
import { parsePieceForm } from '../../../../lib/piece-form';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const values = parsePieceForm(form);
  if (!values) return redirect('/admin/pieces/new?error=invalid', 303);

  const db = getDb();
  const existing = await db
    .select({ id: tables.pieces.id })
    .from(tables.pieces)
    .where(eq(tables.pieces.accession, values.accession))
    .limit(1);
  if (existing.length > 0) return redirect('/admin/pieces/new?error=accession', 303);

  const [created] = await db
    .insert(tables.pieces)
    .values({ ...values, isPublic: false })
    .returning({ id: tables.pieces.id });

  return redirect(`/admin/pieces/${created.id}?saved=created`, 303);
};
