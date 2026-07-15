/**
 * Connection detection: runs the model over one piece plus the catalog and
 * stores unapproved AI link proposals. Shared by intake commit (detect for
 * the new piece) and the piece page's rescan action.
 */

import { and, eq, ne, or, sql } from 'drizzle-orm';
import { getDb, tables } from './db';
import { proposeConnections } from './ai';

/**
 * Detect connections for a piece against the current catalog and store the
 * proposals unapproved (created_by = 'ai'). Pairs that already have a link
 * in either direction, in any state, are skipped, so approved links and
 * still-pending proposals are never duplicated. Returns how many new
 * proposals were stored.
 */
export async function detectAndStoreConnections(pieceId: number): Promise<number> {
  const db = getDb();
  const { pieces, pieceLinks } = tables;

  // Approved transcriptions ride along as grounding text, per the addendum.
  const withGatedTranscription = {
    id: pieces.id,
    accession: pieces.accession,
    title: pieces.title,
    label: pieces.label,
    transcription: sql<
      string | null
    >`case when ${pieces.transcriptionReviewed} then ${pieces.transcription} else null end`,
  };

  const [subject] = await db.select(withGatedTranscription).from(pieces).where(eq(pieces.id, pieceId)).limit(1);
  if (!subject) return 0;

  // The catalog the model sees: owned pieces only. Prospects are candidates
  // for purchase, not part of the collection's story yet.
  const candidates = await db
    .select(withGatedTranscription)
    .from(pieces)
    .where(and(ne(pieces.id, pieceId), ne(pieces.status, 'prospect')));

  const proposals = await proposeConnections(subject, candidates);
  if (proposals.length === 0) return 0;

  const existing = await db
    .select({ fromPieceId: pieceLinks.fromPieceId, toPieceId: pieceLinks.toPieceId })
    .from(pieceLinks)
    .where(or(eq(pieceLinks.fromPieceId, pieceId), eq(pieceLinks.toPieceId, pieceId)));
  const alreadyLinked = new Set(
    existing.map((l) => (l.fromPieceId === pieceId ? l.toPieceId : l.fromPieceId)),
  );

  const idByAccession = new Map(candidates.map((c) => [c.accession, c.id]));
  const rows = proposals.flatMap((p) => {
    const toPieceId = idByAccession.get(p.accession);
    if (!toPieceId || alreadyLinked.has(toPieceId)) return [];
    return [{ fromPieceId: pieceId, toPieceId, reason: p.reason, createdBy: 'ai' as const, approved: false }];
  });
  if (rows.length === 0) return 0;

  await db.insert(pieceLinks).values(rows).onConflictDoNothing();
  return rows.length;
}
