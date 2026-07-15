import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import { getDb, tables } from '../../../lib/db';
import { AiError, aiConfigured, curatorAnswer } from '../../../lib/ai';
import { curatorDailyQuestionLimit, curatorMonthlyTokenCap } from '../../../lib/ai-config';
import { clientIp } from '../../../lib/auth';

export const prerender = false;

const VISITOR_COOKIE = 'bfc_visitor';
const MAX_QUESTION_CHARS = 500;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Ask the curator: the one public AI endpoint. Answers come strictly from
 * published content (the same visibility rules as the public site: only
 * published pieces, only reviewed-and-public transcriptions), single turn,
 * length-capped by configuration.
 *
 * Guardrails, all durable in the curator_questions table: a per-visitor
 * daily question limit (cookie plus IP), and a monthly token cap from the
 * environment; when the cap is reached the box closes for the month.
 * Answers are ephemeral for the visitor but every question and answer is
 * logged for the owner.
 */
export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!aiConfigured()) return json(503, { error: 'unavailable' });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length < 3) return json(400, { error: 'empty' });
  if (question.length > MAX_QUESTION_CHARS) return json(400, { error: 'too-long' });

  // Visitor identity: HTTP-only cookie plus IP, both recorded with the log.
  let visitorId = cookies.get(VISITOR_COOKIE)?.value ?? '';
  if (!/^[a-f0-9]{16,32}$/.test(visitorId)) {
    visitorId = randomBytes(12).toString('hex');
    cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 400,
    });
  }
  const ip = clientIp(request);

  const db = getDb();
  const { curatorQuestions } = tables;

  // Monthly token cap: durable ledger, closes gracefully for the month.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [spend] = await db
    .select({ total: sql<number>`coalesce(sum(${curatorQuestions.inputTokens} + ${curatorQuestions.outputTokens}), 0)::int` })
    .from(curatorQuestions)
    .where(gte(curatorQuestions.createdAt, monthStart));
  if ((spend?.total ?? 0) >= curatorMonthlyTokenCap()) {
    return json(200, { closed: true });
  }

  // Daily per-visitor limit (cookie or IP, whichever trips first).
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [asked] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(curatorQuestions)
    .where(
      and(
        gte(curatorQuestions.createdAt, dayStart),
        or(eq(curatorQuestions.visitorId, visitorId), eq(curatorQuestions.ip, ip)),
      ),
    );
  if ((asked?.count ?? 0) >= curatorDailyQuestionLimit()) {
    return json(429, { error: 'rate' });
  }

  // Grounding: published pieces and rooms only, assembled fresh so it always
  // matches what the public site shows.
  const { pieces, rooms } = tables;
  const [roomRows, pieceRows] = await Promise.all([
    db
      .select({ numeral: rooms.numeral, title: rooms.title, dateRange: rooms.dateRange, wallText: rooms.wallText })
      .from(rooms)
      .orderBy(rooms.sort),
    db
      .select({
        accession: pieces.accession,
        title: pieces.title,
        meta: pieces.meta,
        label: pieces.label,
        transcription: sql<
          string | null
        >`case when ${pieces.transcriptionPublic} and ${pieces.transcriptionReviewed} then ${pieces.transcription} else null end`,
      })
      .from(pieces)
      .where(eq(pieces.status, 'published'))
      .orderBy(pieces.accession),
  ]);

  const grounding = [
    'ROOMS:',
    ...roomRows.map((r) => `Room ${r.numeral}: ${r.title} (${r.dateRange})\n${r.wallText}`),
    '',
    'PIECES:',
    ...pieceRows.map((p) =>
      [
        `<piece accession="${p.accession}">`,
        `Title: ${p.title}`,
        p.meta ? `Meta: ${p.meta}` : null,
        p.label ? `Label: ${p.label}` : null,
        p.transcription ? `Transcription:\n${p.transcription}` : null,
        '</piece>',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n\n');

  try {
    const reply = await curatorAnswer(question, grounding);

    await db.insert(curatorQuestions).values({
      visitorId,
      ip,
      question,
      answer: reply.answer,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    });

    // Accessions present in the answer AND published: the client renders
    // these as links to piece pages.
    const published = new Set(pieceRows.map((p) => p.accession));
    const cited = [...new Set(reply.answer.match(/GCC\.\d{4}\.\d{2}/g) ?? [])].filter((a) => published.has(a));

    return json(200, { answer: reply.answer, accessions: cited });
  } catch (err) {
    if (!(err instanceof AiError)) console.error('[curator] unexpected failure:', err);
    return json(502, { error: 'failed' });
  }
};
