import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../lib/db';
import { AiError, aiConfigured, transcribeImages } from '../../../../../lib/ai';
import { pieceImagesForAi } from '../../../../../lib/piece-images';
import { getPiece, isPublished, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

/**
 * Run AI transcription for one piece, from its stored photographs. The
 * result replaces the piece's transcription and clears the reviewed flag:
 * fresh AI output is a draft until the owner reviews it. If a reviewed,
 * public transcription was showing on the published piece page, the rebuild
 * hook fires so the page stops showing it until re-review.
 *
 * Responds with a redirect for the piece-page button, or JSON when called
 * with ?json=1 (the transcription backfill runs pieces sequentially through
 * this endpoint via fetch).
 */
export const POST: APIRoute = async ({ params, url, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const wantsJson = url.searchParams.get('json') === '1';
  const respond = (ok: boolean, code: string, status: number, extra: Record<string, unknown> = {}) => {
    if (wantsJson) {
      return new Response(JSON.stringify(ok ? { ok: true, ...extra } : { error: code, ...extra }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect(`/admin/pieces/${id}?${ok ? 'saved' : 'error'}=${code}`, 303);
  };

  if (!aiConfigured()) return respond(false, 'ai-config', 503);

  const images = await pieceImagesForAi(id, url.origin);
  if (images.length === 0) return respond(false, 'no-images', 400);

  try {
    const text = await transcribeImages(images);
    const wasShown = Boolean(piece.transcription) && piece.transcriptionReviewed && piece.transcriptionPublic;

    await getDb()
      .update(tables.pieces)
      .set({ transcription: text, transcriptionReviewed: false, updatedAt: new Date() })
      .where(eq(tables.pieces.id, id));

    if (wasShown) {
      await rebuildIfPublic(isPublished(piece), `Transcription replaced, pending review: ${piece.accession}`);
    }
    return respond(true, 'transcribed', 200, { chars: text.length });
  } catch (err) {
    const code = err instanceof AiError && err.kind === 'config' ? 'ai-config' : 'ai-failed';
    if (!(err instanceof AiError)) console.error('[transcribe] unexpected failure:', err);
    return respond(false, code, err instanceof AiError && err.kind === 'config' ? 503 : 502);
  }
};
