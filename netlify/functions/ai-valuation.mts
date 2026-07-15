/**
 * Background worker for AI valuation research.
 *
 * Synchronous Netlify functions are capped at 60 seconds, and real
 * web-search research legitimately runs longer, so this runs as a
 * background function (config.background: true, 15-minute budget). The
 * platform replies 202 to the caller immediately; the admin piece page
 * then polls /api/admin/pieces/[id]/valuations/ai-status, which reads the
 * run state this worker records in Blobs and the valuations table it
 * inserts into.
 *
 * This function lives outside the Astro app, so the admin middleware does
 * not guard it: it verifies the admin session cookie and the request
 * origin itself, before doing anything.
 *
 * Errors are never rethrown: Netlify retries failed background invocations
 * automatically, which would re-run (and re-bill) the research. Every
 * failure is recorded as a `failed` status instead.
 */

import { desc, eq } from 'drizzle-orm';
import { getDb, tables } from '../../src/lib/db';
import { SESSION_COOKIE, verifySessionToken } from '../../src/lib/auth';
import { AiError, aiConfigured, researchValuation } from '../../src/lib/ai';
import { readAiStatus, writeAiStatus } from '../../src/lib/ai-status';

const STALE_RUN_MS = 12 * 60 * 1000;

function cookieValue(header: string | null, name: string): string | undefined {
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function authorized(req: Request): Promise<boolean> {
  const token = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  if (!(await verifySessionToken(token, process.env.SESSION_SECRET))) return false;
  // Same-origin check: browsers always send Origin on fetch POSTs.
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export default async (req: Request) => {
  let pieceId: number | null = null;
  try {
    if (!(await authorized(req))) {
      console.warn('[ai-valuation-bg] unauthorized invocation ignored');
      return;
    }

    const body = await req.json().catch(() => ({}));
    const id = Number((body as { pieceId?: unknown }).pieceId);
    if (!Number.isInteger(id) || id <= 0) return;
    pieceId = id;

    // One run at a time per piece; a stale `running` marker from a crashed
    // run is taken over after 12 minutes.
    const existing = await readAiStatus(id);
    if (existing?.state === 'running' && Date.now() - Date.parse(existing.startedAt) < STALE_RUN_MS) {
      return;
    }
    await writeAiStatus(id, { state: 'running', startedAt: new Date().toISOString() });

    if (!aiConfigured()) {
      await writeAiStatus(id, {
        state: 'failed',
        error: 'ai-config',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const db = getDb();
    const [piece] = await db.select().from(tables.pieces).where(eq(tables.pieces.id, id)).limit(1);
    if (!piece) {
      await writeAiStatus(id, {
        state: 'failed',
        error: 'ai-failed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const [latestCondition] = await db
      .select({ grade: tables.conditionReports.grade })
      .from(tables.conditionReports)
      .where(eq(tables.conditionReports.pieceId, id))
      .orderBy(desc(tables.conditionReports.reportedOn))
      .limit(1);

    const research = await researchValuation({
      accession: piece.accession,
      title: piece.title,
      maker: piece.maker,
      dateDisplay: piece.dateDisplay,
      medium: piece.medium,
      dimensions: piece.dimensions,
      objectType: piece.objectType,
      meta: piece.meta,
      conditionGrade: latestCondition?.grade ?? null,
    });

    await db.insert(tables.valuations).values({
      pieceId: id,
      valuedOn: new Date().toISOString().slice(0, 10),
      method: 'ai_research',
      amountLowCents: research.amountLowCents,
      amountHighCents: research.amountHighCents,
      currency: research.currency,
      comparables: research.comparables,
      notes: research.summary,
    });

    await writeAiStatus(id, {
      state: 'done',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    const kind = err instanceof AiError ? err.kind : 'unexpected';
    console.error('[ai-valuation-bg] failed:', kind, err);
    if (pieceId !== null) {
      try {
        await writeAiStatus(pieceId, {
          state: 'failed',
          error: err instanceof AiError && err.kind === 'config' ? 'ai-config' : 'ai-failed',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
      } catch (statusErr) {
        console.error('[ai-valuation-bg] could not record failure:', statusErr);
      }
    }
  }
};

export const config = {
  background: true,
  path: '/background/ai-valuation',
  method: 'POST',
};
