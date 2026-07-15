/**
 * Run-state records for background AI work, stored in Blobs so admin pages
 * can poll progress. The background function writes them; status endpoints
 * read them. Strong consistency so a just-written state is immediately
 * visible to the poller.
 *
 * Two kinds of runs share the store: piece valuations (key `piece-<id>`,
 * result lands in the valuations table) and field-companion scout runs
 * (key `scout-<runId>`, result rides in the record itself because nothing
 * is written to the catalog until the owner saves).
 */

import { getStore } from '@netlify/blobs';
import type { ValuationResearch } from './ai';

export interface AiRunStatus {
  state: 'running' | 'done' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt?: string;
  /** Scout runs only: the research result itself. */
  result?: ValuationResearch;
}

function store() {
  return getStore({ name: 'ai-status', consistency: 'strong' });
}

export async function readAiStatusKey(key: string): Promise<AiRunStatus | null> {
  return (await store().get(key, { type: 'json' })) as AiRunStatus | null;
}

export async function writeAiStatusKey(key: string, status: AiRunStatus): Promise<void> {
  await store().setJSON(key, status);
}

export async function readAiStatus(pieceId: number): Promise<AiRunStatus | null> {
  return readAiStatusKey(`piece-${pieceId}`);
}

export async function writeAiStatus(pieceId: number, status: AiRunStatus): Promise<void> {
  await writeAiStatusKey(`piece-${pieceId}`, status);
}

const SCOUT_RUN_ID = /^[a-f0-9]{8,32}$/;

export function isScoutRunId(value: unknown): value is string {
  return typeof value === 'string' && SCOUT_RUN_ID.test(value);
}

export function scoutStatusKey(runId: string): string {
  return `scout-${runId}`;
}
