import type { APIRoute } from 'astro';
import { getDb, tables } from '../../../../../lib/db';
import { formStr } from '../../../../../lib/admin-data';
import { getPiece, notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const body = formStr(form, 'body');
  if (!body) return redirect(`/admin/pieces/${id}?error=invalid`, 303);

  const sources = (formStr(form, 'sources') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//.test(line))
    .map((url) => ({ title: '', url }));

  await getDb().insert(tables.researchNotes).values({
    pieceId: id,
    body,
    sources: sources.length > 0 ? sources : null,
    createdBy: 'owner',
  });

  return redirect(`/admin/pieces/${id}?saved=note`, 303);
};
