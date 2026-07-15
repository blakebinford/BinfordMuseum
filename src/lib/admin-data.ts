/**
 * Admin-side data helpers. These run only behind the auth middleware; they
 * may read every field, unlike src/lib/public-data.ts.
 */

import { asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, tables } from './db';

const { pieces, rooms, pieceImages, acquisitions, valuations, conditionReports, researchNotes } = tables;

export async function getDashboard() {
  const db = getDb();

  const [counts] = await db
    .select({
      pieces: sql<number>`count(*)::int`,
      publicPieces: sql<number>`count(*) filter (where ${pieces.status} = 'published')::int`,
      drafts: sql<number>`count(*) filter (where ${pieces.status} = 'draft')::int`,
      prospects: sql<number>`count(*) filter (where ${pieces.status} = 'prospect')::int`,
      missingLabel: sql<number>`count(*) filter (where ${pieces.label} = '')::int`,
    })
    .from(pieces);

  const [children] = await db
    .select({
      withImages: sql<number>`count(distinct ${pieceImages.pieceId})::int`,
      valued: sql<number>`(select count(distinct ${valuations.pieceId}) from ${valuations})::int`,
    })
    .from(pieceImages);

  const recentAcquisitions = await db
    .select({
      id: acquisitions.id,
      pieceId: acquisitions.pieceId,
      accession: pieces.accession,
      title: pieces.title,
      acquiredOn: acquisitions.acquiredOn,
      source: acquisitions.source,
      pricePaidCents: acquisitions.pricePaidCents,
    })
    .from(acquisitions)
    .innerJoin(pieces, eq(acquisitions.pieceId, pieces.id))
    .orderBy(desc(acquisitions.createdAt))
    .limit(5);

  const missingImages = await db
    .select({ id: pieces.id, accession: pieces.accession, title: pieces.title })
    .from(pieces)
    .where(sql`not exists (select 1 from ${pieceImages} where ${pieceImages.pieceId} = ${pieces.id})`)
    .orderBy(asc(pieces.accession));

  const missingLabels = await db
    .select({ id: pieces.id, accession: pieces.accession, title: pieces.title })
    .from(pieces)
    .where(eq(pieces.label, ''))
    .orderBy(asc(pieces.accession));

  const missingValuations = await db
    .select({ id: pieces.id, accession: pieces.accession, title: pieces.title })
    .from(pieces)
    .where(sql`not exists (select 1 from ${valuations} where ${valuations.pieceId} = ${pieces.id})`)
    .orderBy(asc(pieces.accession));

  return {
    counts: { ...counts, withImages: children?.withImages ?? 0, valued: children?.valued ?? 0 },
    recentAcquisitions,
    missingImages,
    missingLabels,
    missingValuations,
  };
}

export async function listPieces() {
  const db = getDb();
  return db
    .select({
      id: pieces.id,
      accession: pieces.accession,
      title: pieces.title,
      objectType: pieces.objectType,
      status: pieces.status,
      roomOrder: pieces.roomOrder,
      roomNumeral: rooms.numeral,
      imageCount: sql<number>`(select count(*) from ${pieceImages} where ${pieceImages.pieceId} = ${pieces.id})::int`,
      updatedAt: pieces.updatedAt,
      label: pieces.label,
      // Admin search includes transcriptions regardless of the public flag.
      transcription: pieces.transcription,
      hasTranscription: sql<boolean>`${pieces.transcription} is not null`,
      transcriptionReviewed: pieces.transcriptionReviewed,
    })
    .from(pieces)
    .leftJoin(rooms, eq(pieces.roomId, rooms.id))
    .orderBy(asc(pieces.accession));
}

export async function getPieceDetail(id: number) {
  const db = getDb();
  const [piece] = await db.select().from(pieces).where(eq(pieces.id, id)).limit(1);
  if (!piece) return null;
  const [images, pieceAcquisitions, pieceValuations, pieceConditions, pieceNotes, allRooms] = await Promise.all([
    db.select().from(pieceImages).where(eq(pieceImages.pieceId, id)).orderBy(asc(pieceImages.sort), asc(pieceImages.id)),
    db.select().from(acquisitions).where(eq(acquisitions.pieceId, id)).orderBy(desc(acquisitions.createdAt)),
    db.select().from(valuations).where(eq(valuations.pieceId, id)).orderBy(asc(valuations.valuedOn), asc(valuations.id)),
    db.select().from(conditionReports).where(eq(conditionReports.pieceId, id)).orderBy(desc(conditionReports.reportedOn)),
    db.select().from(researchNotes).where(eq(researchNotes.pieceId, id)).orderBy(desc(researchNotes.createdAt)),
    db.select().from(rooms).orderBy(asc(rooms.sort)),
  ]);
  return { piece, images, acquisitions: pieceAcquisitions, valuations: pieceValuations, conditionReports: pieceConditions, researchNotes: pieceNotes, rooms: allRooms };
}

export function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "$1,234.56" or "1234.56" or "1234" -> cents, else null. */
export function parseMoneyToCents(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function formStr(form: FormData, name: string): string | null {
  const v = form.get(name);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export function formInt(form: FormData, name: string): number | null {
  const s = formStr(form, name);
  if (s === null) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}
