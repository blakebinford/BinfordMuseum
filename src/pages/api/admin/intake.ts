import type { APIRoute } from 'astro';
import { asc, eq } from 'drizzle-orm';
import { getDb, tables } from '../../../lib/db';
import { AiError, aiConfigured, proposeIntake, transcribeImages, type IntakeImage } from '../../../lib/ai';
import { MAX_UPLOAD_BYTES } from '../../../lib/piece-images';
import { sniffImage } from '../../../lib/image-size';

export const prerender = false;

const MAX_FILES = 4;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Intake step 1: photographs in, proposed catalog entry out. Nothing is
 * written; the owner reviews and edits before committing a draft.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!aiConfigured()) {
    return jsonError(503, 'ANTHROPIC_API_KEY is not configured on the server.');
  }

  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const hints = typeof form.get('hints') === 'string' ? (form.get('hints') as string).trim() : '';

  if (files.length === 0) return jsonError(400, 'Attach at least one photograph.');
  if (files.length > MAX_FILES) return jsonError(400, `Attach at most ${MAX_FILES} photographs.`);

  const images: IntakeImage[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) return jsonError(400, 'Each photograph must be under 8 MB.');
    const buf = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffImage(buf);
    if (!sniffed) return jsonError(400, 'Photographs must be JPEG or PNG.');
    images.push({ data: buf.toString('base64'), mediaType: sniffed.contentType as IntakeImage['mediaType'] });
  }

  // Voice examples: a spread of existing labels from the database.
  const db = getDb();
  const labels = await db
    .select({ label: tables.pieces.label })
    .from(tables.pieces)
    .where(eq(tables.pieces.status, 'published'))
    .orderBy(asc(tables.pieces.accession));
  const voice = labels
    .map((row) => row.label)
    .filter((label) => label.length > 0)
    .filter((_, i) => i % 4 === 0)
    .slice(0, 6);

  // Rooms for the placement suggestion (owner decides).
  const rooms = await db
    .select({ numeral: tables.rooms.numeral, title: tables.rooms.title })
    .from(tables.rooms)
    .orderBy(asc(tables.rooms.sort));

  try {
    // Transcription runs in parallel with the proposal (same photographs,
    // independent calls). A transcription failure does not fail intake; the
    // owner can run it again from the piece page after committing.
    const [proposal, transcription] = await Promise.all([
      proposeIntake(images, hints, voice, rooms),
      transcribeImages(images).catch((err) => {
        console.warn('[intake] transcription failed (continuing without it):', err);
        return null;
      }),
    ]);
    return new Response(JSON.stringify({ proposal, transcription }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof AiError) {
      const status = err.kind === 'config' ? 503 : err.kind === 'refusal' ? 422 : 502;
      return jsonError(status, err.message);
    }
    console.error('[intake] unexpected failure:', err);
    return jsonError(500, 'Intake failed unexpectedly.');
  }
};
