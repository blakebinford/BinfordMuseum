import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { formStr } from '../../../../../lib/admin-data';
import { fireBuildHook } from '../../../../../lib/build-hook';
import { getPiece, isPublished, notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

/**
 * Owner review of a piece's transcription: edited text, the reviewed flag,
 * and the public-display flag. Both flags require text; public display on
 * the piece page additionally requires reviewed (enforced again in the
 * public data layer). Fires the rebuild hook when the published page's
 * visible transcription changes in text or visibility.
 */
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const text = formStr(form, 'transcription');
  const reviewed = form.get('reviewed') === 'true' && text !== null;
  const showPublic = form.get('public') === 'true' && text !== null;

  await getDb()
    .update(tables.pieces)
    .set({
      transcription: text,
      transcriptionReviewed: reviewed,
      transcriptionPublic: showPublic,
      updatedAt: new Date(),
    })
    .where(eq(tables.pieces.id, id));

  const wasShown = Boolean(piece.transcription) && piece.transcriptionReviewed && piece.transcriptionPublic;
  const nowShown = Boolean(text) && reviewed && showPublic;
  const visibleChange = wasShown !== nowShown || (nowShown && piece.transcription !== text);
  if (isPublished(piece) && visibleChange) {
    await fireBuildHook(`Transcription updated: ${piece.accession}`);
  }

  return redirect(`/admin/pieces/${id}?saved=transcription`, 303);
};
