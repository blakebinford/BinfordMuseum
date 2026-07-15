import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { getStore } from '@netlify/blobs';
import { getDb, tables } from '../../../../../lib/db';
import { sniffImage } from '../../../../../lib/image-size';
import { getPiece, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const KINDS = new Set(['front', 'back', 'detail']);

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const file = form.get('file');
  const kindRaw = form.get('kind');
  const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw) ? (kindRaw as 'front' | 'back' | 'detail') : 'front';
  const altRaw = form.get('alt');
  const alt = typeof altRaw === 'string' && altRaw.trim() !== '' ? altRaw.trim() : piece.title;

  if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return redirect(`/admin/pieces/${id}?error=image`, 303);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(buf);
  if (!sniffed) return redirect(`/admin/pieces/${id}?error=image`, 303);

  // Immutable, unique key: replacing an image is a new key, so CDN and
  // browser caches never serve a stale original.
  const slug = piece.accession.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const blobKey = `pieces/${slug}-${kind}-${randomBytes(4).toString('hex')}.${sniffed.ext}`;

  const store = getStore('images');
  await store.set(blobKey, new Blob([buf], { type: sniffed.contentType }));

  const db = getDb();
  const [last] = await db
    .select({ sort: tables.pieceImages.sort })
    .from(tables.pieceImages)
    .where(eq(tables.pieceImages.pieceId, id))
    .orderBy(desc(tables.pieceImages.sort))
    .limit(1);

  await db.insert(tables.pieceImages).values({
    pieceId: id,
    blobKey,
    kind,
    width: sniffed.width,
    height: sniffed.height,
    alt,
    sort: kind === 'front' ? 0 : (last?.sort ?? 0) + 1,
  });

  await rebuildIfPublic(piece.isPublic, `Image added: ${piece.accession}`);
  return redirect(`/admin/pieces/${id}?saved=image`, 303);
};
