import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

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

  let body: ArrayBuffer | null = null;
  try {
    const store = getStore('images');
    body = await store.get(key, { type: 'arrayBuffer' });
  } catch {
    body = null;
  }

  // Local development fallback: before the one-time blob seed has run (or in
  // `astro dev` with an empty sandbox store), serve the committed original.
  if (!body) {
    try {
      const { readFile } = await import('node:fs/promises');
      const file = key.replace(/^pieces\//, '');
      if (!/^[a-z0-9.-]+$/.test(file)) return new Response('Not found', { status: 404 });
      const buf = await readFile(new URL(`../../../seed/images/${file}`, import.meta.url));
      body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      // Keys are immutable: replacing a piece image writes a new key, so
      // derivatives and browsers may cache indefinitely.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
