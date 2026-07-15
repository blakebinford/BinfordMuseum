/**
 * Background worker for AI valuation research.
 *
 * Synchronous Netlify functions are capped at 60 seconds, and real
 * web-search research legitimately runs longer, so this runs as a
 * background function (config.background: true, 15-minute budget). The
 * platform replies 202 immediately; the admin piece page polls
 * /api/admin/pieces/[id]/valuations/ai-status for the run state this
 * worker records in Blobs and the valuations row it inserts.
 *
 * Authorization is a short-lived signed run token carried in the request
 * body, minted by the authenticated dispatcher endpoint
 * (/api/admin/pieces/[id]/valuations/ai). Background invocations are
 * delivered asynchronously, so nothing here depends on cookies or other
 * browser headers surviving the queue; the body is documented to be
 * delivered. The dispatcher also owns the one-run-per-piece guard and
 * writes the initial `running` status.
 *
 * Errors are never rethrown: Netlify retries failed background
 * invocations, which would re-run (and re-bill) the research. Every
 * failure is recorded as a `failed` status instead.
 */

import { desc, eq } from 'drizzle-orm';
import { getDb, tables } from '../../src/lib/db';
import { verifyScopedToken } from '../../src/lib/auth';
import { AiError, aiConfigured, researchValuation } from '../../src/lib/ai';
import { writeAiStatus } from '../../src/lib/ai-status';

export default async (req: Request) => {
  let pieceId: number | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { pieceId?: unknown; token?: unknown };
    const id = Number(body.pieceId);
    if (!Number.isInteger(id) || id <= 0) {
      console.warn('[ai-valuation-bg] invocation without a valid pieceId ignored');
      return;
    }
    const token = typeof body.token === 'string' ? body.token : undefined;
    if (!(await verifyScopedToken(token, `ai-valuation:${id}`, process.env.SESSION_SECRET))) {
      console.warn('[ai-valuation-bg] invalid or expired run token; invocation ignored');
      return;
    }
    pieceId = id;

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

// Background mode is declared three ways so any one of them suffices: the
// -background filename suffix (the original, most widely supported signal),
// config.background here, and a [functions] block in netlify.toml. A run
// observed in production was cut at exactly 60 seconds, the synchronous
// limit, meaning in-source config.background alone was not honored.
export const config = {
  background: true,
  path: '/background/ai-valuation',
};
