/**
 * The public data access layer. Every public page and payload is built
 * exclusively through this module, and this module only ever selects the
 * fields below. Prices paid, sellers, valuations, condition reports,
 * research notes, and non-public provenance are structurally unreachable
 * from here: the queries name allowed columns explicitly (never `select()`
 * whole tables that carry private fields), and the one join into
 * `acquisitions` filters on `is_public_provenance` and selects
 * `provenance_text` alone.
 */

import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, tables } from './db';

export interface PublicRoom {
  id: number;
  numeral: string;
  title: string;
  dateRange: string;
  wallText: string;
  sort: number;
}

export interface PublicImage {
  blobKey: string;
  kind: 'front' | 'back' | 'detail';
  width: number;
  height: number;
  alt: string;
  sort: number;
}

export interface PublicPiece {
  accession: string;
  title: string;
  maker: string | null;
  dateDisplay: string | null;
  dateSortYear: number | null;
  medium: string | null;
  dimensions: string | null;
  objectType: string;
  meta: string | null;
  roomId: number | null;
  roomOrder: number | null;
  label: string;
  /** Present only when the owner marked the transcription reviewed AND public. */
  transcription: string | null;
  publicProvenance: string | null;
  images: PublicImage[];
}

/** An approved connection between two published pieces. */
export interface PublicLink {
  fromAccession: string;
  toAccession: string;
  reason: string;
}

export interface PublicCollection {
  rooms: PublicRoom[];
  pieces: PublicPiece[];
  links: PublicLink[];
}

async function fromDatabase(): Promise<PublicCollection> {
  const db = getDb();
  const { rooms, pieces, pieceImages, acquisitions } = tables;

  const roomRows = await db
    .select({
      id: rooms.id,
      numeral: rooms.numeral,
      title: rooms.title,
      dateRange: rooms.dateRange,
      wallText: rooms.wallText,
      sort: rooms.sort,
    })
    .from(rooms)
    .orderBy(asc(rooms.sort));

  const pieceRows = await db
    .select({
      id: pieces.id,
      accession: pieces.accession,
      title: pieces.title,
      maker: pieces.maker,
      dateDisplay: pieces.dateDisplay,
      dateSortYear: pieces.dateSortYear,
      medium: pieces.medium,
      dimensions: pieces.dimensions,
      objectType: pieces.objectType,
      meta: pieces.meta,
      roomId: pieces.roomId,
      roomOrder: pieces.roomOrder,
      label: pieces.label,
      // The transcription reaches a public surface only when the owner
      // reviewed it AND flagged it public; enforced in the query itself so
      // unapproved text never leaves the database on this path.
      transcription: sql<string | null>`case when ${pieces.transcriptionPublic} and ${pieces.transcriptionReviewed} then ${pieces.transcription} else null end`,
    })
    .from(pieces)
    // Only published pieces, ever. Drafts and prospects (field-companion
    // saves of pieces the owner does not own) are structurally excluded
    // from every public surface.
    .where(eq(pieces.status, 'published'))
    .orderBy(asc(pieces.dateSortYear), asc(pieces.accession));

  const ids = pieceRows.map((p) => p.id);

  const imageRows = ids.length
    ? await db
        .select({
          pieceId: pieceImages.pieceId,
          blobKey: pieceImages.blobKey,
          kind: pieceImages.kind,
          width: pieceImages.width,
          height: pieceImages.height,
          alt: pieceImages.alt,
          sort: pieceImages.sort,
        })
        .from(pieceImages)
        .where(inArray(pieceImages.pieceId, ids))
        .orderBy(asc(pieceImages.sort))
    : [];

  // The only acquisition data that may ever reach a public surface:
  // provenance_text on rows the owner explicitly marked public.
  const provenanceRows = ids.length
    ? await db
        .select({
          pieceId: acquisitions.pieceId,
          provenanceText: acquisitions.provenanceText,
        })
        .from(acquisitions)
        .where(eq(acquisitions.isPublicProvenance, true))
    : [];

  const provenanceByPiece = new Map<number, string>();
  for (const row of provenanceRows) {
    if (row.provenanceText) provenanceByPiece.set(row.pieceId, row.provenanceText);
  }

  // Approved connections whose BOTH ends are published pieces (the id ->
  // accession map below only contains published rows, so links touching a
  // draft or prospect drop out here).
  const linkRows = await db
    .select({
      fromPieceId: tables.pieceLinks.fromPieceId,
      toPieceId: tables.pieceLinks.toPieceId,
      reason: tables.pieceLinks.reason,
    })
    .from(tables.pieceLinks)
    .where(eq(tables.pieceLinks.approved, true));
  const accessionById = new Map(pieceRows.map((p) => [p.id, p.accession]));
  const links = linkRows.flatMap((l) => {
    const fromAccession = accessionById.get(l.fromPieceId);
    const toAccession = accessionById.get(l.toPieceId);
    return fromAccession && toAccession ? [{ fromAccession, toAccession, reason: l.reason }] : [];
  });

  return {
    rooms: roomRows,
    links,
    pieces: pieceRows.map(({ id, ...piece }) => ({
      ...piece,
      publicProvenance: provenanceByPiece.get(id) ?? null,
      images: imageRows
        .filter((i) => i.pieceId === id)
        .map(({ pieceId, ...image }) => image),
    })),
  };
}

async function fromSeedFile(): Promise<PublicCollection> {
  const { default: collection } = await import('../../seed/collection.json');
  return {
    links: [],
    rooms: collection.rooms.map((r) => ({
      id: r.id,
      numeral: r.numeral,
      title: r.title,
      dateRange: r.dateRange,
      wallText: r.wallText,
      sort: r.sort,
    })),
    pieces: collection.pieces
      .filter((p) => p.isPublic)
      .map((p) => ({
        accession: p.accession,
        title: p.title,
        maker: p.maker,
        dateDisplay: p.dateDisplay,
        dateSortYear: p.dateSortYear,
        medium: p.medium,
        dimensions: p.dimensions,
        objectType: p.objectType,
        meta: p.meta,
        roomId: p.roomId,
        roomOrder: p.roomOrder,
        label: p.label,
        transcription: null,
        publicProvenance: null,
        images: p.images as PublicImage[],
      })),
  };
}

let cached: PublicCollection | null = null;

/**
 * Netlify Database applies migrations after the build, immediately before a
 * deploy is published, so a build whose code ships new migrations always
 * prerenders against a database that is one schema version behind. Two
 * Postgres errors mark that exact state, possibly wrapped by the driver or
 * Drizzle: 42P01 (undefined_table; the very first deploy, or a deploy that
 * adds a table this build queries) and 42703 (undefined_column; a deploy
 * that adds columns this build selects, as the piece status and
 * transcription migrations did).
 */
function isNotYetMigrated(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (code === '42P01' || code === '42703') return true;
    if (/relation "[^"]+" does not exist/.test(current.message)) return true;
    if (/column "?[\w.]+"? does not exist/.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Public collection for build-time rendering. Uses the Netlify Database when
 * a connection is present (always the case on Netlify once the database is
 * provisioned). Two narrow fallbacks build from the committed seed
 * extraction instead: offline local builds with no NETLIFY_DB_URL, and any
 * deploy whose migrations have not yet been applied, because the platform
 * applies them after the build (the first deploy with no tables at all, and
 * every deploy that ships new tables or columns the build queries). The
 * fallback publishes the seed content for that one deploy; migrations apply
 * at its end, and the next build renders from the database. Anything else,
 * including an unreachable database, still fails the build rather than
 * shipping stale content.
 */
export async function getPublicCollection(): Promise<PublicCollection> {
  if (cached) return cached;
  if (process.env.NETLIFY_DB_URL) {
    try {
      cached = await fromDatabase();
    } catch (err) {
      if (!isNotYetMigrated(err)) throw err;
      console.warn(
        '[public-data] Database is reachable but behind this build\'s schema (expected when a deploy ships new migrations; they apply at the end of this deploy). ' +
          'Building public pages from the committed seed. Trigger one more deploy afterward so the site renders from the database again.',
      );
      cached = await fromSeedFile();
    }
  } else if (process.env.NETLIFY === 'true') {
    throw new Error(
      'Netlify build has no NETLIFY_DB_URL. Netlify Database is not provisioned; refusing to build public pages from the seed file.',
    );
  } else {
    console.warn('[public-data] No NETLIFY_DB_URL; building from seed/collection.json (local fallback).');
    cached = await fromSeedFile();
  }
  return cached;
}
