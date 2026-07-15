import type { APIRoute } from 'astro';
import { getDb, tables } from '../../../../../lib/db';
import { formStr, parseMoneyToCents } from '../../../../../lib/admin-data';
import { getPiece, isDateString, notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

// Manual valuation entry. AI-researched valuations arrive through the
// intake/valuation flow and always carry method 'ai_research'.
const MANUAL_METHODS = new Set(['comparable_sale', 'appraisal', 'owner_estimate']);

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const valuedOn = formStr(form, 'valued_on');
  const methodRaw = formStr(form, 'method');
  if (!isDateString(valuedOn) || !methodRaw || !MANUAL_METHODS.has(methodRaw)) {
    return redirect(`/admin/pieces/${id}?error=invalid`, 303);
  }

  await getDb().insert(tables.valuations).values({
    pieceId: id,
    valuedOn,
    method: methodRaw as 'comparable_sale' | 'appraisal' | 'owner_estimate',
    amountLowCents: parseMoneyToCents(form.get('amount_low')),
    amountHighCents: parseMoneyToCents(form.get('amount_high')),
    currency: 'USD',
    notes: formStr(form, 'notes'),
  });

  return redirect(`/admin/pieces/${id}?saved=valuation`, 303);
};
