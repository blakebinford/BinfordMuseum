/**
 * Field-companion (scout) run plumbing. A run is ephemeral: photographs live
 * in the Blobs `images` store under scout/<runId>-* (never publicly
 * addressable; the /img route serves only pieces/), the valuation result
 * lives in the ai-status store, and nothing touches the catalog until the
 * owner explicitly saves, which copies the photographs to real piece keys
 * and deletes the scout copies.
 */

import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { sniffImage } from './image-size';
import type { IntakeImage, ScoutIdentification } from './ai';

export const SCOUT_MAX_FILES = 3;

export function newScoutRunId(): string {
  return randomBytes(8).toString('hex');
}

export async function saveScoutImages(runId: string, bufs: Buffer[]): Promise<number> {
  const store = getStore('images');
  let saved = 0;
  for (const [i, buf] of bufs.entries()) {
    const sniffed = sniffImage(buf);
    if (!sniffed) continue;
    await store.set(`scout/${runId}-${i}.${sniffed.ext}`, new Blob([buf], { type: sniffed.contentType }));
    saved += 1;
  }
  return saved;
}

export interface ScoutImage extends IntakeImage {
  blobKey: string;
  buf: Buffer;
}

export async function readScoutImages(runId: string): Promise<ScoutImage[]> {
  const store = getStore('images');
  const { blobs } = await store.list({ prefix: `scout/${runId}-` });
  const out: ScoutImage[] = [];
  for (const blob of blobs.slice(0, SCOUT_MAX_FILES)) {
    const body = await store.get(blob.key, { type: 'arrayBuffer' });
    if (!body) continue;
    const buf = Buffer.from(body);
    const sniffed = sniffImage(buf);
    if (!sniffed) continue;
    out.push({
      blobKey: blob.key,
      buf,
      data: buf.toString('base64'),
      mediaType: sniffed.contentType as IntakeImage['mediaType'],
    });
  }
  return out;
}

export async function deleteScoutImages(runId: string): Promise<void> {
  const store = getStore('images');
  const { blobs } = await store.list({ prefix: `scout/${runId}-` });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
}

/** Sanitize a client-supplied identification back to plain strings. */
export function sanitizeIdentification(raw: unknown): ScoutIdentification {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const OBJECT_TYPES = ['map', 'document', 'currency', 'stereoview', 'photograph', 'print', 'certificate', 'object'];
  const objectType = str(obj.objectType);
  return {
    title: str(obj.title) ?? 'Unidentified piece',
    objectType: (objectType && OBJECT_TYPES.includes(objectType) ? objectType : 'object') as ScoutIdentification['objectType'],
    dateDisplay: str(obj.dateDisplay),
    maker: str(obj.maker),
    medium: str(obj.medium),
    description: str(obj.description) ?? '',
  };
}
