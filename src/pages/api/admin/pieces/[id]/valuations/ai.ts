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
 * estimate.
 *
 * The response is a newline-delimited stream: `working` heartbeats begin
 * immediately and repeat every few seconds while the research runs, and the
 * final line is a JSON result. Streaming matters here: Netlify's edge cuts
 * buffered responses that have sent no bytes long before the 60-second
 * synchronous function limit, and the research legitimately takes tens of
 * seconds. The piece page reads the stream with fetch and then navigates,
 * reusing the existing notice codes.
 */
export const POST: APIRoute = async ({ params }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(line + '\n'));
      const finish = (result: { done: boolean; error?: string }) => {
        send(JSON.stringify(result));
        controller.close();
      };

      send('working');
      const heartbeat = setInterval(() => {
        try {
          send('working');
        } catch {
          clearInterval(heartbeat);
        }
      }, 4000);

      try {
        if (!aiConfigured()) {
          finish({ done: false, error: 'ai-config' });
          return;
        }

        const db = getDb();
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

        finish({ done: true });
      } catch (err) {
        if (err instanceof AiError) {
          console.error('[ai-valuation]', err.kind, err.message);
          finish({ done: false, error: err.kind === 'config' ? 'ai-config' : 'ai-failed' });
        } else {
          console.error('[ai-valuation] unexpected failure:', err);
          finish({ done: false, error: 'ai-failed' });
        }
      } finally {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  });
};
