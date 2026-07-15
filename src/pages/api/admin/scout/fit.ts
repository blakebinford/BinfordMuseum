import type { APIRoute } from 'astro';
import { asc, eq, ne } from 'drizzle-orm';
import { getDb, tables } from '../../../../lib/db';
import { AiError, aiConfigured, scoutFit } from '../../../../lib/ai';
import { VOICE_EXAMPLE_COUNT } from '../../../../lib/ai-config';
import { sanitizeIdentification } from '../../../../lib/scout';

export const prerender = false;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Fit note for a scout run: one short paragraph on what the piece adds to
 * or duplicates in the collection's story, referencing rooms and existing
 * accessions.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!aiConfigured()) return json(503, { error: 'ai-config' });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const identification = sanitizeIdentification(body.identification);

  const db = getDb();
  const { pieces, rooms } = tables;
  const [roomRows, catalog, labels] = await Promise.all([
    db
      .select({ numeral: rooms.numeral, title: rooms.title, wallText: rooms.wallText })
      .from(rooms)
      .orderBy(asc(rooms.sort)),
    db
      .select({ accession: pieces.accession, title: pieces.title, objectType: pieces.objectType })
      .from(pieces)
      .where(ne(pieces.status, 'prospect'))
      .orderBy(asc(pieces.accession)),
    db
      .select({ label: pieces.label })
      .from(pieces)
      .where(eq(pieces.status, 'published'))
      .orderBy(asc(pieces.accession)),
  ]);

  const voice = labels
    .map((row) => row.label)
    .filter((label) => label.length > 0)
    .filter((_, i) => i % 4 === 0)
    .slice(0, VOICE_EXAMPLE_COUNT);

  try {
    const note = await scoutFit(identification, roomRows, catalog, voice);
    return json(200, { note });
  } catch (err) {
    if (err instanceof AiError) {
      return json(err.kind === 'config' ? 503 : 502, { error: err.kind === 'config' ? 'ai-config' : 'ai-failed' });
    }
    console.error('[scout] fit note failed:', err);
    return json(500, { error: 'ai-failed' });
  }
};
