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

import { asc, eq, inArray } from 'drizzle-orm';
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
  publicProvenance: string | null;
  images: PublicImage[];
}

export interface PublicCollection {
  rooms: PublicRoom[];
  pieces: PublicPiece[];
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
    })
    .from(pieces)
    .where(eq(pieces.isPublic, true))
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

  return {
    rooms: roomRows,
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
        publicProvenance: null,
        images: p.images as PublicImage[],
      })),
  };
}

let cached: PublicCollection | null = null;

/**
 * Public collection for build-time rendering. Uses the Netlify Database when
 * a connection is present (always the case on Netlify once the database is
 * provisioned); on a Netlify build with no database it fails the build
 * rather than silently shipping stale content. Offline local builds fall
 * back to the committed seed extraction.
 */
export async function getPublicCollection(): Promise<PublicCollection> {
  if (cached) return cached;
  if (process.env.NETLIFY_DB_URL) {
    cached = await fromDatabase();
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
