/**
 * Central AI configuration, per the addendum's cost rules: every model name
 * and per-call limit lives here rather than scattered through code. All
 * features run on the current Claude Sonnet model (verified against current
 * Anthropic docs, July 2026).
 *
 * Efforts use the API's output_config.effort tiers. Web-search-bearing calls
 * are also bounded by max_uses and a pause_turn continuation cap.
 */

export const AI_MODEL = 'claude-sonnet-5';

export const AI_LIMITS = {
  /** Intake catalog-entry proposal (vision + structured output). */
  intake: { maxTokens: 3000 },
  /** Full-text transcription of a piece's photographs. */
  transcription: { maxTokens: 4000, effort: 'medium' },
  /** Valuation research (web search); the long call. */
  valuationResearch: { maxTokens: 8000, effort: 'medium', webSearchMaxUses: 5, maxContinuations: 3 },
  /** Structured extraction from research notes; short and cheap. */
  valuationExtraction: { maxTokens: 2500, effort: 'low' },
  /** Connection proposals between a piece and the existing catalog. */
  connections: { maxTokens: 3000, effort: 'medium', maxProposals: 6 },
  /** Field companion: quick identification from photographs. */
  scoutIdentify: { maxTokens: 1500, effort: 'low' },
  /** Field companion: duplicate verdict against catalog candidates. */
  scoutDuplicates: { maxTokens: 2000, effort: 'low' },
  /** Field companion: one-paragraph fit note. */
  scoutFit: { maxTokens: 1200, effort: 'medium' },
  /** Ask the curator: public answers; short by design. */
  curator: { maxTokens: 700, effort: 'low' },
} as const;

/** Number of existing labels supplied as voice examples to prose-drafting prompts. */
export const VOICE_EXAMPLE_COUNT = 5;

/**
 * Ask-the-curator guardrails. The monthly token cap and daily per-visitor
 * question limit are environment-tunable; defaults are deliberately modest.
 */
export function curatorDailyQuestionLimit(): number {
  const n = Number(process.env.CURATOR_DAILY_QUESTIONS);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

export function curatorMonthlyTokenCap(): number {
  const n = Number(process.env.CURATOR_MONTHLY_TOKEN_CAP);
  return Number.isInteger(n) && n > 0 ? n : 2_000_000;
}
