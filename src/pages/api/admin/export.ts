import type { APIRoute } from 'astro';
import { asc, eq } from 'drizzle-orm';
import { getDb, tables } from '../../../lib/db';

export const prerender = false;

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dollars(cents: number | null): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);
}

/**
 * Full-inventory CSV suitable for an insurance schedule: catalog record,
 * acquisition data, latest valuation per piece (a query over the time
 * series, per the data model), and latest condition. AI-derived valuations
 * are marked as estimates.
 */
export const GET: APIRoute = async () => {
  const db = getDb();
  const { pieces, rooms, acquisitions, valuations, conditionReports, pieceImages } = tables;

  const [pieceRows, acquisitionRows, valuationRows, conditionRows, imageRows] = await Promise.all([
    db
      .select({
        id: pieces.id,
        accession: pieces.accession,
        title: pieces.title,
        maker: pieces.maker,
        dateDisplay: pieces.dateDisplay,
        dateSortYear: pieces.dateSortYear,
        objectType: pieces.objectType,
        medium: pieces.medium,
        dimensions: pieces.dimensions,
        isPublic: pieces.isPublic,
        roomNumeral: rooms.numeral,
        roomTitle: rooms.title,
      })
      .from(pieces)
      .leftJoin(rooms, eq(pieces.roomId, rooms.id))
      .orderBy(asc(pieces.accession)),
    db.select().from(acquisitions),
    db.select().from(valuations),
    db.select().from(conditionReports),
    db.select({ pieceId: pieceImages.pieceId }).from(pieceImages),
  ]);

  const acquisitionByPiece = new Map<number, (typeof acquisitionRows)[number]>();
  for (const a of acquisitionRows) {
    const current = acquisitionByPiece.get(a.pieceId);
    if (!current || a.createdAt > current.createdAt) acquisitionByPiece.set(a.pieceId, a);
  }

  // Latest valuation per piece: newest valued_on, ties broken by insertion id.
  const valuationByPiece = new Map<number, (typeof valuationRows)[number]>();
  for (const v of valuationRows) {
    const current = valuationByPiece.get(v.pieceId);
    if (!current || v.valuedOn > current.valuedOn || (v.valuedOn === current.valuedOn && v.id > current.id)) {
      valuationByPiece.set(v.pieceId, v);
    }
  }

  const conditionByPiece = new Map<number, (typeof conditionRows)[number]>();
  for (const c of conditionRows) {
    const current = conditionByPiece.get(c.pieceId);
    if (!current || c.reportedOn > current.reportedOn) conditionByPiece.set(c.pieceId, c);
  }

  const imageCount = new Map<number, number>();
  for (const img of imageRows) imageCount.set(img.pieceId, (imageCount.get(img.pieceId) ?? 0) + 1);

  const METHOD_LABELS: Record<string, string> = {
    ai_research: 'AI research (estimate)',
    comparable_sale: 'Comparable sale',
    appraisal: 'Appraisal',
    owner_estimate: 'Owner estimate',
  };
  const GRADE_LABELS: Record<string, string> = {
    fine: 'Fine',
    very_good: 'Very Good',
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
  };

  const header = [
    'accession', 'title', 'maker', 'date', 'sort_year', 'object_type', 'medium', 'dimensions', 'room', 'status',
    'acquired_on', 'acquisition_source', 'price_paid_usd', 'provenance',
    'latest_valuation_on', 'valuation_method', 'value_low_usd', 'value_high_usd', 'valuation_currency', 'valuation_notes',
    'latest_condition', 'condition_reported_on', 'image_count',
  ];

  const lines = [header.join(',')];
  for (const p of pieceRows) {
    const a = acquisitionByPiece.get(p.id);
    const v = valuationByPiece.get(p.id);
    const c = conditionByPiece.get(p.id);
    lines.push(
      [
        csvCell(p.accession),
        csvCell(p.title),
        csvCell(p.maker),
        csvCell(p.dateDisplay),
        csvCell(p.dateSortYear),
        csvCell(p.objectType),
        csvCell(p.medium),
        csvCell(p.dimensions),
        csvCell(p.roomNumeral ? `Room ${p.roomNumeral}: ${p.roomTitle}` : 'Unplaced'),
        csvCell(p.isPublic ? 'public' : 'draft'),
        csvCell(a?.acquiredOn ?? ''),
        csvCell(a?.source ?? ''),
        csvCell(dollars(a?.pricePaidCents ?? null)),
        csvCell(a?.provenanceText ?? ''),
        csvCell(v?.valuedOn ?? ''),
        csvCell(v ? (METHOD_LABELS[v.method] ?? v.method) : ''),
        csvCell(dollars(v?.amountLowCents ?? null)),
        csvCell(dollars(v?.amountHighCents ?? null)),
        csvCell(v?.currency ?? ''),
        csvCell(v?.notes ?? ''),
        csvCell(c ? (GRADE_LABELS[c.grade] ?? c.grade) : ''),
        csvCell(c?.reportedOn ?? ''),
        csvCell(imageCount.get(p.id) ?? 0),
      ].join(','),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gulf-coast-collection-inventory-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
