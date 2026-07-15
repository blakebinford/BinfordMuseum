import type { APIRoute } from 'astro';
import { readOriginalImage } from '../../lib/piece-images';

// On-demand route serving original images from the Blobs `images` store.
// The Netlify Image CDN uses this as its same-site source
// (/.netlify/images?url=/img/<key>&w=...), so most traffic is served from
// the CDN's derivative cache, not this function.
export const prerender = false;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? '';

  // Only piece images are addressable. Blob keys are server-assigned; never
  // serve arbitrary store paths from user input.
  if (!key.startsWith('pieces/') || key.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return new Response('Not found', { status: 404 });

  // Blobs store first, then the committed seed originals (local development
  // before the one-time blob seed has run).
  const buf = await readOriginalImage(key);
  if (!buf) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': contentType,
      // Keys are immutable: replacing a piece image writes a new key, so
      // derivatives and browsers may cache indefinitely.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
