import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../lib/db';
import { formStr } from '../../../../lib/admin-data';
import { parsePieceForm } from '../../../../lib/piece-form';
import { saveImageForPiece } from '../../../../lib/piece-images';

export const prerender = false;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Intake step 2: the reviewed proposal plus the original photographs become a
 * draft piece (status = draft; publishing is a separate explicit action on
 * the piece page, which fires the rebuild hook).
 */
export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const values = parsePieceForm(form);
  if (!values) return jsonError(400, 'The proposal is missing required fields.');

  const db = getDb();
  const clash = await db
    .select({ id: tables.pieces.id })
    .from(tables.pieces)
    .where(eq(tables.pieces.accession, values.accession))
    .limit(1);
  if (clash.length > 0) return jsonError(409, 'That accession number is already in use.');

  // The intake transcription (edited by the owner in the review form) lands
  // on the draft. Public display stays off; that is a separate decision on
  // the piece page.
  const transcription = formStr(form, 'transcription');
  const transcriptionReviewed = form.get('transcription_reviewed') === 'true' && transcription !== null;

  const [created] = await db
    .insert(tables.pieces)
    .values({ ...values, status: 'draft', transcription, transcriptionReviewed })
    .returning({ id: tables.pieces.id, accession: tables.pieces.accession, title: tables.pieces.title });

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  let savedCount = 0;
  for (const [index, file] of files.entries()) {
    const kind = index === 0 ? 'front' : 'detail';
    const saved = await saveImageForPiece(created, Buffer.from(await file.arrayBuffer()), kind, null);
    if (saved) savedCount += 1;
  }

  return new Response(JSON.stringify({ id: created.id, images: savedCount }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
