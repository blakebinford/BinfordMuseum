/** Shared image persistence for admin uploads and intake. */

import { randomBytes } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { getStore } from '@netlify/blobs';
import { getDb, tables } from './db';
import { sniffImage } from './image-size';
import type { IntakeImage } from './ai';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// The Anthropic API caps images at roughly 5 MB; stay under it.
const AI_IMAGE_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

export type ImageKind = 'front' | 'back' | 'detail';

export interface SavedImage {
  blobKey: string;
  width: number;
  height: number;
}

/**
 * Reads a piece image's original bytes: the Blobs `images` store first, then
 * the committed seed originals (the same fallback order as the public /img
 * route, for local work before the one-time blob seed has run). Returns null
 * when the key is outside pieces/ or nothing is found.
 */
export async function readOriginalImage(blobKey: string): Promise<Buffer | null> {
  if (!blobKey.startsWith('pieces/') || blobKey.includes('..')) return null;
  try {
    const body = await getStore('images').get(blobKey, { type: 'arrayBuffer' });
    if (body) return Buffer.from(body);
  } catch {
    // fall through to the seed copy
  }
  const file = blobKey.replace(/^pieces\//, '');
  if (!/^[a-z0-9.-]+$/.test(file)) return null;
  const { readFile } = await import('node:fs/promises');
  // The committed seed originals ride along via the function's included
  // files. Where they land relative to the bundled chunk depends on the
  // packaging (deployed function root, local build layout, dev server), so
  // try each plausible base.
  const candidates = [
    new URL(`seed/images/${file}`, `file://${process.cwd()}/`),
    new URL(`../../../seed/images/${file}`, import.meta.url),
    new URL(`../../seed/images/${file}`, import.meta.url),
  ];
  for (const url of candidates) {
    try {
      return await readFile(url);
    } catch {
      // try the next base
    }
  }
  return null;
}

/**
 * A piece's stored photographs as base64 payloads for a vision call: front
 * first, then back, then details (text on versos matters for transcription).
 * Originals over the API's per-image size limit are re-fetched as a JPEG
 * derivative through the Image CDN; if that fails the image is skipped.
 */
export async function pieceImagesForAi(pieceId: number, origin: string, maxImages = 4): Promise<IntakeImage[]> {
  const db = getDb();
  const rows = await db
    .select({ blobKey: tables.pieceImages.blobKey, kind: tables.pieceImages.kind })
    .from(tables.pieceImages)
    .where(eq(tables.pieceImages.pieceId, pieceId))
    .orderBy(asc(tables.pieceImages.sort), asc(tables.pieceImages.id));

  const priority: Record<string, number> = { front: 0, back: 1, detail: 2 };
  rows.sort((a, b) => (priority[a.kind] ?? 3) - (priority[b.kind] ?? 3));

  const out: IntakeImage[] = [];
  for (const row of rows) {
    if (out.length >= maxImages) break;
    let buf = await readOriginalImage(row.blobKey);
    if (!buf) continue;
    let mediaType = sniffImage(buf)?.contentType as IntakeImage['mediaType'] | undefined;
    if (!mediaType) continue;
    if (buf.length > AI_IMAGE_MAX_BYTES) {
      try {
        const derivative = new URL('/.netlify/images', origin);
        derivative.searchParams.set('url', `/img/${row.blobKey}`);
        derivative.searchParams.set('w', '2400');
        derivative.searchParams.set('q', '85');
        derivative.searchParams.set('fm', 'jpg');
        const res = await fetch(derivative);
        if (!res.ok) continue;
        buf = Buffer.from(await res.arrayBuffer());
        mediaType = 'image/jpeg';
        if (buf.length > AI_IMAGE_MAX_BYTES) continue;
      } catch {
        continue;
      }
    }
    out.push({ data: buf.toString('base64'), mediaType });
  }
  return out;
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
