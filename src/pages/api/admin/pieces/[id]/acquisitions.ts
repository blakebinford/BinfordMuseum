import type { APIRoute } from 'astro';
import { getDb, tables } from '../../../../../lib/db';
import { formStr, parseMoneyToCents } from '../../../../../lib/admin-data';
import { getPiece, isDateString, notFound, parseId, rebuildIfPublic } from '../../../../../lib/admin-api';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const acquiredOn = formStr(form, 'acquired_on');
  const isPublicProvenance = form.get('is_public_provenance') === 'true';

  await getDb().insert(tables.acquisitions).values({
    pieceId: id,
    acquiredOn: isDateString(acquiredOn) ? acquiredOn : null,
    source: formStr(form, 'source'),
    pricePaidCents: parseMoneyToCents(form.get('price_paid')),
    provenanceText: formStr(form, 'provenance_text'),
    isPublicProvenance,
    notes: formStr(form, 'notes'),
  });

  // Public provenance appears on the public piece page.
  if (isPublicProvenance) await rebuildIfPublic(piece.isPublic, `Provenance updated: ${piece.accession}`);
  return redirect(`/admin/pieces/${id}?saved=acquisition`, 303);
};
