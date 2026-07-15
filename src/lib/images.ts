/**
 * Netlify Image CDN URLs for blob-backed originals.
 *
 * Originals live in the Blobs `images` store and are exposed at
 * /img/<blobKey> by an on-demand route; the Image CDN produces derivatives
 * from that same-site source per the current Image CDN docs
 * (/.netlify/images?url=<relative source>&w=...&q=...). Format negotiation
 * (avif/webp) is automatic, so no `fm` parameter is set.
 */

const GALLERY_WIDTHS = [480, 730, 940, 1400];

export function originalUrl(blobKey: string): string {
  return `/img/${blobKey}`;
}

export function cdnUrl(blobKey: string, opts: { w?: number; q?: number } = {}): string {
  const params = new URLSearchParams({ url: originalUrl(blobKey) });
  if (opts.w) params.set('w', String(opts.w));
  if (opts.q) params.set('q', String(opts.q));
  return `/.netlify/images?${params.toString()}`;
}

/** Responsive srcset capped at the original's natural width. */
export function cdnSrcset(blobKey: string, naturalWidth: number): string {
  const widths = GALLERY_WIDTHS.filter((w) => w <= naturalWidth);
  if (widths.length === 0 || widths[widths.length - 1] !== naturalWidth) {
    widths.push(naturalWidth);
  }
  return widths.map((w) => `${cdnUrl(blobKey, { w })} ${w}w`).join(', ');
}

/** Large single-image URL for the lightbox and piece pages. */
export function cdnLargeUrl(blobKey: string, naturalWidth: number): string {
  return cdnUrl(blobKey, { w: Math.min(1400, naturalWidth) });
}
