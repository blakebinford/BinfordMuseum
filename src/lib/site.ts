/**
 * Site identity. The collection was renamed by the owner after launch; the
 * name is centralized here and the seeded prototype copy stays verbatim,
 * with the old name swapped at render time where it appears (the exit
 * colophon). Accession numbers keep their GCC prefix: they are catalog
 * data and shareable URLs, not branding.
 */

export const SITE_NAME = 'The Binford Collection';

const PROTOTYPE_NAME = 'The Gulf Coast Collection';

export function rebrand(text: string): string {
  return text.split(PROTOTYPE_NAME).join(SITE_NAME);
}
