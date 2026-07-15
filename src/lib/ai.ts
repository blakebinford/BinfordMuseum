/**
 * AI features: intake proposals (vision) and valuation research (web search),
 * both on the current Claude Sonnet model via the owner's ANTHROPIC_API_KEY.
 *
 * Verified against current Anthropic docs (July 2026): claude-sonnet-5 is the
 * current Sonnet; adaptive thinking is its default (no thinking config sent);
 * sampling parameters are not sent (rejected on this model); structured JSON
 * comes from output_config.format; the current web search tool for it is
 * web_search_20260209. Netlify synchronous functions allow 60 seconds, which
 * bounds the research call (web search capped via max_uses).
 */

import Anthropic from '@anthropic-ai/sdk';

export const SONNET = 'claude-sonnet-5';

let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'refusal' | 'api' | 'shape' = 'api',
  ) {
    super(message);
  }
}

const OBJECT_TYPES = ['map', 'document', 'currency', 'stereoview', 'photograph', 'print', 'certificate', 'object'] as const;

// ------------------------------------------------------------------- intake

export interface IntakeProposal {
  title: string;
  dateDisplay: string | null;
  dateSortYear: number | null;
  maker: string | null;
  medium: string | null;
  objectType: (typeof OBJECT_TYPES)[number];
  meta: string;
  label: string;
  notes: string;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'date_display', 'date_sort_year', 'maker', 'medium', 'object_type', 'meta', 'label', 'notes'],
  properties: {
    title: { type: 'string', description: 'Piece title in the collection style: descriptive, no quotation marks.' },
    date_display: nullable({ type: 'string', description: 'Display date, e.g. "1851" or "c. 1901-1903" or "April 23, 1841".' }),
    date_sort_year: nullable({ type: 'integer', description: 'Single sortable year.' }),
    maker: nullable({ type: 'string', description: 'Maker, publisher, or issuer if identifiable.' }),
    medium: nullable({ type: 'string', description: 'Medium or process, e.g. "Hand-colored engraving".' }),
    object_type: { type: 'string', enum: [...OBJECT_TYPES] },
    meta: { type: 'string', description: 'Placard meta line: segments joined by " · ", date first.' },
    label: { type: 'string', description: 'The draft wall label, 3 to 7 sentences.' },
    notes: { type: 'string', description: 'Uncertainties the owner should verify, one short paragraph. Empty string if none.' },
  },
} as const;

export interface IntakeImage {
  data: string; // base64
  mediaType: 'image/jpeg' | 'image/png';
}

export async function proposeIntake(
  images: IntakeImage[],
  hints: string,
  voiceExamples: string[],
): Promise<IntakeProposal> {
  if (!aiConfigured()) throw new AiError('ANTHROPIC_API_KEY is not set', 'config');

  const system = [
    'You are the cataloger for The Gulf Coast Collection, a private collection of Texana focused on Galveston, its harbor, and the engineering record of the Texas Gulf Coast, 1841 to 1930.',
    'You are shown photographs of a newly acquired piece. Propose a catalog entry for the owner to review.',
    'Write the label in the collection’s established curatorial voice. Study these existing labels as voice examples:',
    ...voiceExamples.map((label, i) => `<label_example index="${i + 1}">\n${label}\n</label_example>`),
    'The register: confident, historically grounded prose that explains why the piece matters and how it connects to the coast’s story; concrete detail over adjectives; sentences that carry their own weight; no first person, no direct address, no hedging filler.',
    'Never use em dashes anywhere in any field. Use commas, colons, or separate sentences instead.',
    'Identify only what the photographs and hints support. Put genuine uncertainties in the notes field rather than inventing specifics like catalog numbers, printers, or exact dates.',
  ].join('\n\n');

  const content: Anthropic.ContentBlockParam[] = [
    ...images.map((img): Anthropic.ImageBlockParam => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })),
    {
      type: 'text',
      text: `Propose the catalog entry for this piece.${hints ? `\n\nOwner's notes about the piece:\n${hints}` : ''}`,
    },
  ];

  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create({
      model: SONNET,
      max_tokens: 3000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: INTAKE_SCHEMA } },
    });
  } catch (err) {
    throw toAiError(err);
  }

  if (response.stop_reason === 'refusal') throw new AiError('The model declined this request.', 'refusal');
  const parsed = parseJsonText(response);

  const objectType = OBJECT_TYPES.includes(parsed.object_type) ? parsed.object_type : 'object';
  return {
    title: stripEmDashes(String(parsed.title ?? '')),
    dateDisplay: optionalString(parsed.date_display),
    dateSortYear: Number.isInteger(parsed.date_sort_year) ? parsed.date_sort_year : null,
    maker: optionalString(parsed.maker),
    medium: optionalString(parsed.medium),
    objectType,
    meta: stripEmDashes(String(parsed.meta ?? '')),
    label: stripEmDashes(String(parsed.label ?? '')),
    notes: stripEmDashes(String(parsed.notes ?? '')),
  };
}

// ---------------------------------------------------------------- valuation

export interface ValuationResearch {
  amountLowCents: number | null;
  amountHighCents: number | null;
  currency: 'USD';
  comparables: Array<{ source: string; description: string; price: string; date: string; url: string }>;
  summary: string;
}

const VALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['amount_low', 'amount_high', 'comparables', 'summary'],
  properties: {
    amount_low: nullable({ type: 'number', description: 'Low end of the estimated value range in USD.' }),
    amount_high: nullable({ type: 'number', description: 'High end of the estimated value range in USD.' }),
    comparables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'description', 'price', 'date', 'url'],
        properties: {
          source: { type: 'string', description: 'E.g. "Heritage Auctions", "eBay sold listing", dealer name.' },
          description: { type: 'string' },
          price: { type: 'string', description: 'Realized or asking price as stated, e.g. "$1,380 (sold)".' },
          date: { type: 'string', description: 'Sale or listing date if known, else empty string.' },
          url: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', description: 'Three to six sentences: basis for the range, comparability caveats, market notes.' },
  },
} as const;

export interface PieceForValuation {
  accession: string;
  title: string;
  maker: string | null;
  dateDisplay: string | null;
  medium: string | null;
  dimensions: string | null;
  objectType: string;
  meta: string | null;
  conditionGrade: string | null;
}

export async function researchValuation(piece: PieceForValuation): Promise<ValuationResearch> {
  if (!aiConfigured()) throw new AiError('ANTHROPIC_API_KEY is not set', 'config');
  const client = getClient();

  const description = [
    `Title: ${piece.title}`,
    piece.dateDisplay ? `Date: ${piece.dateDisplay}` : null,
    piece.maker ? `Maker/issuer: ${piece.maker}` : null,
    piece.medium ? `Medium: ${piece.medium}` : null,
    piece.dimensions ? `Dimensions: ${piece.dimensions}` : null,
    `Object type: ${piece.objectType}`,
    piece.meta ? `Catalog meta line: ${piece.meta}` : null,
    piece.conditionGrade ? `Owner's condition grade: ${piece.conditionGrade}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const researchSystem =
    'You are a market researcher for a private Texana collection. Research recent comparable sales for the piece described and estimate a fair market value range in USD. ' +
    'Prioritize, in order: Heritage Auctions (ha.com) results, eBay sold listings, and specialist dealer catalogs (maps, currency, ephemera, photographica). ' +
    'Prefer realized prices over asking prices and say which is which. Note condition and edition differences that limit comparability. ' +
    'Be conservative: if evidence is thin, say so and widen the range. Never use em dashes.';

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Research comparable sales and estimate a value range for this piece:\n\n${description}` },
  ];

  // Server-side web search loop; resume on pause_turn per current docs.
  // Medium effort keeps the search loop well inside Netlify's 60-second
  // synchronous function limit without changing the research instructions.
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: SONNET,
      max_tokens: 8000,
      system: researchSystem,
      messages,
      output_config: { effort: 'medium' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    });
    let continuations = 0;
    while (response.stop_reason === 'pause_turn' && continuations < 3) {
      messages.push({ role: 'assistant', content: response.content });
      response = await client.messages.create({
        model: SONNET,
        max_tokens: 8000,
        system: researchSystem,
        messages,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      });
      continuations += 1;
    }
  } catch (err) {
    throw toAiError(err);
  }
  if (response.stop_reason === 'refusal') throw new AiError('The model declined this request.', 'refusal');

  const researchText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  // Harvest source URLs from search result blocks and citations.
  const sources = new Map<string, string>();
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === 'web_search_result' && result.url) sources.set(result.url, result.title ?? '');
      }
    }
    if (block.type === 'text' && block.citations) {
      for (const citation of block.citations) {
        if ('url' in citation && citation.url) sources.set(citation.url, citation.title ?? '');
      }
    }
  }
  const sourceList = [...sources.entries()].map(([url, title]) => `- ${title || url}: ${url}`).join('\n');

  // Second, short request extracts the structured record from the research.
  // (Kept separate because structured outputs and citation-bearing search
  // results are incompatible in a single request.)
  let extraction: Anthropic.Message;
  try {
    extraction = await client.messages.create({
      model: SONNET,
      max_tokens: 2500,
      system:
        'Extract a structured valuation record from the research notes. Include only comparables actually mentioned, with their URLs taken from the source list. At most 6 comparables. Amounts in USD. Never use em dashes.',
      messages: [
        {
          role: 'user',
          content: `Research notes:\n\n${researchText}\n\nSource URLs seen during research:\n${sourceList || '(none)'}`,
        },
      ],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: VALUATION_SCHEMA } },
    });
  } catch (err) {
    throw toAiError(err);
  }
  if (extraction.stop_reason === 'refusal') throw new AiError('The model declined this request.', 'refusal');
  const parsed = parseJsonText(extraction);

  const toCents = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;

  return {
    amountLowCents: toCents(parsed.amount_low),
    amountHighCents: toCents(parsed.amount_high),
    currency: 'USD',
    comparables: Array.isArray(parsed.comparables)
      ? parsed.comparables.slice(0, 6).map((c: Record<string, unknown>) => ({
          source: stripEmDashes(String(c.source ?? '')),
          description: stripEmDashes(String(c.description ?? '')),
          price: String(c.price ?? ''),
          date: String(c.date ?? ''),
          url: String(c.url ?? ''),
        }))
      : [],
    summary: stripEmDashes(String(parsed.summary ?? '')),
  };
}

// ------------------------------------------------------------------ helpers

function stripEmDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ', ').trim();
}

function optionalString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = stripEmDashes(v);
  return trimmed === '' ? null : trimmed;
}

function parseJsonText(response: Anthropic.Message): any {
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('The model returned output that could not be parsed.', 'shape');
  }
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError('Anthropic API key was rejected.', 'config');
  if (err instanceof Anthropic.RateLimitError) return new AiError('Anthropic rate limit reached; try again shortly.', 'api');
  if (err instanceof Anthropic.APIError) return new AiError(`Anthropic API error (${err.status}).`, 'api');
  return new AiError('Could not reach the Anthropic API.', 'api');
}
