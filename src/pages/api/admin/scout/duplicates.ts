import type { APIRoute } from 'astro';
import { inArray, ne } from 'drizzle-orm';
import { getDb, tables } from '../../../../lib/db';
import { AiError, aiConfigured, scoutDuplicates } from '../../../../lib/ai';
import { cdnUrl } from '../../../../lib/images';
import { isScoutRunId } from '../../../../lib/ai-status';
import { readScoutImages, sanitizeIdentification } from '../../../../lib/scout';

export const prerender = false;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Duplicate check for a scout run: the photographs plus the quick
 * identification against the catalog's text. Candidates come back with
 * thumbnails so the owner can compare at the table.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!aiConfigured()) return json(503, { error: 'ai-config' });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isScoutRunId(body.runId)) return json(400, { error: 'bad-run' });
  const identification = sanitizeIdentification(body.identification);

  const images = await readScoutImages(body.runId);
  if (images.length === 0) return json(400, { error: 'bad-run' });

  const db = getDb();
  const { pieces, pieceImages } = tables;
  const catalog = await db
    .select({
      id: pieces.id,
      accession: pieces.accession,
      title: pieces.title,
      objectType: pieces.objectType,
      label: pieces.label,
    })
    .from(pieces)
    .where(ne(pieces.status, 'prospect'));

  try {
    const check = await scoutDuplicates(
      images.map(({ data, mediaType }) => ({ data, mediaType })),
      identification,
      catalog,
    );

    // Thumbnails and admin links for the plausible matches.
    const byAccession = new Map(catalog.map((p) => [p.accession, p]));
    const candidateIds = check.candidates
      .map((c) => byAccession.get(c.accession)?.id)
      .filter((id): id is number => typeof id === 'number');
    const fronts = candidateIds.length
      ? await db
          .select({ pieceId: pieceImages.pieceId, blobKey: pieceImages.blobKey, kind: pieceImages.kind })
          .from(pieceImages)
          .where(inArray(pieceImages.pieceId, candidateIds))
      : [];
    const frontByPiece = new Map<number, string>();
    for (const img of fronts) {
      if (img.kind === 'front' || !frontByPiece.has(img.pieceId)) frontByPiece.set(img.pieceId, img.blobKey);
    }

    return json(200, {
      verdict: check.verdict,
      explanation: check.explanation,
      candidates: check.candidates.map((c) => {
        const piece = byAccession.get(c.accession)!;
        const blobKey = frontByPiece.get(piece.id);
        return {
          accession: c.accession,
          title: piece.title,
          note: c.note,
          thumb: blobKey ? cdnUrl(blobKey, { w: 340 }) : null,
          adminUrl: `/admin/pieces/${piece.id}`,
        };
      }),
    });
  } catch (err) {
    if (err instanceof AiError) {
      return json(err.kind === 'config' ? 503 : 502, { error: err.kind === 'config' ? 'ai-config' : 'ai-failed' });
    }
    console.error('[scout] duplicate check failed:', err);
    return json(500, { error: 'ai-failed' });
  }
};
