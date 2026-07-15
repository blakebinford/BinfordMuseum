/** Shared image persistence for admin uploads and intake. */

import { randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getStore } from '@netlify/blobs';
import { getDb, tables } from './db';
import { sniffImage } from './image-size';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type ImageKind = 'front' | 'back' | 'detail';

export interface SavedImage {
  blobKey: string;
  width: number;
  height: number;
}

/**
 * Validates, stores, and records one image for a piece. Returns null when the
 * buffer is not an acceptable JPEG/PNG. Keys are unique and immutable so CDN
 * derivatives never go stale.
 */
export async function saveImageForPiece(
  piece: { id: number; accession: string; title: string },
  buf: Buffer,
  kind: ImageKind,
  alt: string | null,
): Promise<SavedImage | null> {
  if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) return null;
  const sniffed = sniffImage(buf);
  if (!sniffed) return null;

  const slug = piece.accession.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const blobKey = `pieces/${slug}-${kind}-${randomBytes(4).toString('hex')}.${sniffed.ext}`;

  const store = getStore('images');
  await store.set(blobKey, new Blob([buf], { type: sniffed.contentType }));

  const db = getDb();
  const [last] = await db
    .select({ sort: tables.pieceImages.sort })
    .from(tables.pieceImages)
    .where(eq(tables.pieceImages.pieceId, piece.id))
    .orderBy(desc(tables.pieceImages.sort))
    .limit(1);

  await db.insert(tables.pieceImages).values({
    pieceId: piece.id,
    blobKey,
    kind,
    width: sniffed.width,
    height: sniffed.height,
    alt: alt?.trim() || piece.title,
    sort: kind === 'front' ? 0 : (last?.sort ?? 0) + 1,
  });

  return { blobKey, width: sniffed.width, height: sniffed.height };
}
