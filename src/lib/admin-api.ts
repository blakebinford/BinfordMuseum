/** Shared plumbing for the admin API endpoints. */

import { eq } from 'drizzle-orm';
import { getDb, tables } from './db';
import { fireBuildHook } from './build-hook';

export function parseId(param: string | undefined): number | null {
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function getPiece(id: number) {
  const [piece] = await getDb().select().from(tables.pieces).where(eq(tables.pieces.id, id)).limit(1);
  return piece ?? null;
}

export function isDateString(v: string | null): v is string {
  return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Rebuild the public site when a change touches published content. */
export async function rebuildIfPublic(pieceIsPublished: boolean, reason: string): Promise<void> {
  if (pieceIsPublished) await fireBuildHook(reason);
}

/** Whether a piece's content is on the public site. */
export function isPublished(piece: { status: 'prospect' | 'draft' | 'published' }): boolean {
  return piece.status === 'published';
}

export function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
