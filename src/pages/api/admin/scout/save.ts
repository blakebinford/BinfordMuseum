import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../lib/db';
import { isScoutRunId, readAiStatusKey, scoutStatusKey } from '../../../../lib/ai-status';
import { deleteScoutImages, readScoutImages, sanitizeIdentification } from '../../../../lib/scout';
import { saveImageForPiece } from '../../../../lib/piece-images';

export const prerender = false;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Save a scout run as a PROSPECT: a piece under consideration, kept out of
 * every public surface and the insurance export by its status. Photographs
 * move from the run's scout/ keys to real piece keys; the asking price and
 * source go into an owner research note; the fit note and any completed
 * valuation research are recorded too. Converting to a draft later is an
 * explicit action on the piece page. Nothing here fires the build hook:
 * prospects are never public.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isScoutRunId(body.runId)) return json(400, { error: 'bad-run' });
  const runId = body.runId;
  const identification = sanitizeIdentification(body.identification);

  const images = await readScoutImages(runId);
  if (images.length === 0) return json(400, { error: 'bad-run' });

  const askingPrice = typeof body.askingPrice === 'string' ? body.askingPrice.trim() : '';
  const where = typeof body.where === 'string' ? body.where.trim() : '';
  const fitNote = typeof body.fitNote === 'string' ? body.fitNote.trim() : '';

  const db = getDb();
  const { pieces, researchNotes, valuations } = tables;

  const today = new Date().toISOString().slice(0, 10);
  const accession = `PROSPECT.${today.replace(/-/g, '')}.${runId.slice(0, 6).toUpperCase()}`;
  const clash = await db.select({ id: pieces.id }).from(pieces).where(eq(pieces.accession, accession)).limit(1);
  if (clash.length > 0) return json(409, { error: 'That scout run is already saved.' });

  const [created] = await db
    .insert(pieces)
    .values({
      accession,
      title: identification.title,
      maker: identification.maker,
      dateDisplay: identification.dateDisplay,
      medium: identification.medium,
      objectType: identification.objectType,
      meta: identification.description || null,
      status: 'prospect',
    })
    .returning({ id: pieces.id, accession: pieces.accession, title: pieces.title });

  for (const [index, img] of images.entries()) {
    await saveImageForPiece(created, img.buf, index === 0 ? 'front' : 'detail', null);
  }
  await deleteScoutImages(runId).catch((err) => console.warn('[scout] could not clean run images:', err));

  const scoutedLine = [
    'Scouted with the field companion.',
    where ? `Seen at: ${where}.` : null,
    askingPrice ? `Asking price: ${askingPrice}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  await db.insert(researchNotes).values({ pieceId: created.id, body: scoutedLine, createdBy: 'owner' });
  if (fitNote) {
    await db.insert(researchNotes).values({ pieceId: created.id, body: fitNote, createdBy: 'ai' });
  }

  // If the run's valuation research finished, record it against the
  // prospect from the server-side status record (never client data).
  const status = await readAiStatusKey(scoutStatusKey(runId)).catch(() => null);
  if (status?.state === 'done' && status.result) {
    const r = status.result;
    await db.insert(valuations).values({
      pieceId: created.id,
      valuedOn: today,
      method: 'ai_research',
      amountLowCents: r.amountLowCents,
      amountHighCents: r.amountHighCents,
      currency: r.currency,
      comparables: r.comparables,
      notes: r.summary,
    });
  }

  return json(200, { id: created.id, accession: created.accession });
};
