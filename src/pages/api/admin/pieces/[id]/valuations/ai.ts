import type { APIRoute } from 'astro';
import { desc, eq } from 'drizzle-orm';
import { getDb, tables } from '../../../../../../lib/db';
import { AiError, aiConfigured, researchValuation } from '../../../../../../lib/ai';
import { getPiece, notFound, parseId } from '../../../../../../lib/admin-api';

export const prerender = false;

/**
 * On-demand AI valuation research for one piece: the current Claude Sonnet
 * model with web search researches comparable sales (Heritage Auctions, eBay
 * sold listings, dealer catalogs) and the result is stored as a new
 * valuations row with method ai_research. Displayed everywhere as an
 * estimate. Runs synchronously within Netlify's 60-second function limit
 * (web search capped at 5 uses).
 */
export const POST: APIRoute = async ({ params, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  if (!aiConfigured()) return redirect(`/admin/pieces/${id}?error=ai-config`, 303);

  const db = getDb();
  const [latestCondition] = await db
    .select({ grade: tables.conditionReports.grade })
    .from(tables.conditionReports)
    .where(eq(tables.conditionReports.pieceId, id))
    .orderBy(desc(tables.conditionReports.reportedOn))
    .limit(1);

  try {
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

    return redirect(`/admin/pieces/${id}?saved=ai-valuation`, 303);
  } catch (err) {
    if (err instanceof AiError) {
      console.error('[ai-valuation]', err.kind, err.message);
      const code = err.kind === 'config' ? 'ai-config' : 'ai-failed';
      return redirect(`/admin/pieces/${id}?error=${code}`, 303);
    }
    console.error('[ai-valuation] unexpected failure:', err);
    return redirect(`/admin/pieces/${id}?error=ai-failed`, 303);
  }
};
