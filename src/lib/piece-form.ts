/** Shared parsing/validation for the piece create and update endpoints. */

import { formInt, formStr } from './admin-data';

const OBJECT_TYPES = new Set(['map', 'document', 'currency', 'stereoview', 'photograph', 'print', 'certificate', 'object']);

export interface PieceFormValues {
  accession: string;
  title: string;
  objectType: 'map' | 'document' | 'currency' | 'stereoview' | 'photograph' | 'print' | 'certificate' | 'object';
  dateDisplay: string | null;
  dateSortYear: number | null;
  maker: string | null;
  medium: string | null;
  dimensions: string | null;
  meta: string | null;
  roomId: number | null;
  roomOrder: number | null;
  label: string;
}

export function parsePieceForm(form: FormData): PieceFormValues | null {
  const accession = formStr(form, 'accession');
  const title = formStr(form, 'title');
  const objectType = formStr(form, 'object_type');
  if (!accession || !title || !objectType || !OBJECT_TYPES.has(objectType)) return null;

  // The label is interface copy on the public site: strip em dashes defensively.
  const label = (formStr(form, 'label') ?? '').replace(/\s*—\s*/g, ', ');

  return {
    accession,
    title,
    objectType: objectType as PieceFormValues['objectType'],
    dateDisplay: formStr(form, 'date_display'),
    dateSortYear: formInt(form, 'date_sort_year'),
    maker: formStr(form, 'maker'),
    medium: formStr(form, 'medium'),
    dimensions: formStr(form, 'dimensions'),
    meta: formStr(form, 'meta'),
    roomId: formInt(form, 'room_id'),
    roomOrder: formInt(form, 'room_order'),
    label,
  };
}
