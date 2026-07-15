import type { APIRoute } from 'astro';
import { getDb, tables } from '../../../../../lib/db';
import { formStr } from '../../../../../lib/admin-data';
import { getPiece, isDateString, notFound, parseId } from '../../../../../lib/admin-api';

export const prerender = false;

const GRADES = new Set(['fine', 'very_good', 'good', 'fair', 'poor']);

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = parseId(params.id);
  if (!id) return notFound();
  const piece = await getPiece(id);
  if (!piece) return notFound();

  const form = await request.formData();
  const reportedOn = formStr(form, 'reported_on');
  const grade = formStr(form, 'grade');
  if (!isDateString(reportedOn) || !grade || !GRADES.has(grade)) {
    return redirect(`/admin/pieces/${id}?error=invalid`, 303);
  }

  await getDb().insert(tables.conditionReports).values({
    pieceId: id,
    reportedOn,
    grade: grade as 'fine' | 'very_good' | 'good' | 'fair' | 'poor',
    notes: formStr(form, 'notes'),
  });

  return redirect(`/admin/pieces/${id}?saved=condition`, 303);
};
