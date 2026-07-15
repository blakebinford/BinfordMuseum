import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { fireBuildHook } from '../../../../../lib/build-hook';
import { getPiece, notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const makePublic = form.get('public') === 'true';

  await getDb()
    .update(tables.pieces)
    .set({ isPublic: makePublic, updatedAt: new Date() })
    .where(eq(tables.pieces.id, id));

  const { fired } = await fireBuildHook(
    `${makePublic ? 'Published' : 'Unpublished'}: ${piece.accession}`,
  );

  const saved = makePublic ? (fired ? 'published' : 'published-nohook') : fired ? 'unpublished' : 'unpublished-nohook';
  return redirect(`/admin/pieces/${id}?saved=${saved}`, 303);
};
