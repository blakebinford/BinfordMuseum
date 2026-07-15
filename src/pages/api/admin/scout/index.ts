import type { APIRoute } from 'astro';
import { AiError, aiConfigured, scoutIdentify, type IntakeImage } from '../../../../lib/ai';
import { MAX_UPLOAD_BYTES } from '../../../../lib/piece-images';
import { sniffImage } from '../../../../lib/image-size';
import { newScoutRunId, saveScoutImages, SCOUT_MAX_FILES } from '../../../../lib/scout';

export const prerender = false;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Field companion, step one: photographs in, a scout run out. Stores the
 * photographs under scout/<runId> and returns a quick identification. The
 * page then runs the duplicate check, valuation research, and fit note in
 * parallel against this run. Nothing touches the catalog.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!aiConfigured()) return json(503, { error: 'ai-config' });

  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return json(400, { error: 'Photograph the piece first.' });
  if (files.length > SCOUT_MAX_FILES) return json(400, { error: `At most ${SCOUT_MAX_FILES} photographs.` });

  const bufs: Buffer[] = [];
  const images: IntakeImage[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) return json(400, { error: 'Each photograph must be under 8 MB.' });
    const buf = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffImage(buf);
    if (!sniffed) return json(400, { error: 'Photographs must be JPEG or PNG.' });
    bufs.push(buf);
    images.push({ data: buf.toString('base64'), mediaType: sniffed.contentType as IntakeImage['mediaType'] });
  }

  const runId = newScoutRunId();
  try {
    const [identification] = await Promise.all([scoutIdentify(images), saveScoutImages(runId, bufs)]);
    return json(200, { runId, identification });
  } catch (err) {
    if (err instanceof AiError) {
      return json(err.kind === 'config' ? 503 : 502, { error: err.kind === 'config' ? 'ai-config' : 'ai-failed' });
    }
    console.error('[scout] start failed:', err);
    return json(500, { error: 'ai-failed' });
  }
};
