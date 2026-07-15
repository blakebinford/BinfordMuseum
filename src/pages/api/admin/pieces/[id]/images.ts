import type { APIRoute } from 'astro';
import { saveImageForPiece } from '../../../../../lib/piece-images';
import { getPiece, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

const KINDS = new Set(['front', 'back', 'detail']);

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const file = form.get('file');
  const kindRaw = form.get('kind');
  const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw) ? (kindRaw as 'front' | 'back' | 'detail') : 'front';
  const altRaw = form.get('alt');
  const alt = typeof altRaw === 'string' ? altRaw : null;

  if (!(file instanceof File)) return redirect(`/admin/pieces/${id}?error=image`, 303);

  const saved = await saveImageForPiece(piece, Buffer.from(await file.arrayBuffer()), kind, alt);
  if (!saved) return redirect(`/admin/pieces/${id}?error=image`, 303);

  await rebuildIfPublic(piece.isPublic, `Image added: ${piece.accession}`);
  return redirect(`/admin/pieces/${id}?saved=image`, 303);
};
