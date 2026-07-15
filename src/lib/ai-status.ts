/**
 * Run-state record for background AI valuation research, stored in Blobs so
 * the admin piece page can poll progress. The background function writes it;
 * the status endpoint reads it. Strong consistency so a just-written state
 * is immediately visible to the poller.
 */

import { getStore } from '@netlify/blobs';

export interface AiValuationStatus {
  state: 'running' | 'done' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

function store() {
  return getStore({ name: 'ai-status', consistency: 'strong' });
}

function key(pieceId: number): string {
  return `piece-${pieceId}`;
}

export async function readAiStatus(pieceId: number): Promise<AiValuationStatus | null> {
  return (await store().get(key(pieceId), { type: 'json' })) as AiValuationStatus | null;
}

export async function writeAiStatus(pieceId: number, status: AiValuationStatus): Promise<void> {
  await store().setJSON(key(pieceId), status);
}
