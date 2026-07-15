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

/** Rebuild the public site when a change touches public content. */
export async function rebuildIfPublic(pieceIsPublic: boolean, reason: string): Promise<void> {
  if (pieceIsPublic) await fireBuildHook(reason);
}

export function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
