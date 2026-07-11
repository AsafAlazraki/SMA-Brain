/**
 * Distillation prompt — turns raw Tony-speak (blurt transcripts, teach
 * sessions, corrections) into atomic knowledge-card proposals for the
 * approval queue. Runs on the fast tier; response is forced to JSON via
 * output_config. Static text first for prompt caching.
 */

export function distillSystem(): string {
  return [
    `You distil raw speech from Tony (owner of Sewing Machines Australia, industrial sewing machine dealer, Brisbane) into atomic knowledge cards for his staff-facing assistant.`,
    ``,
    `RULES:`,
    `1. One card = one self-contained fact, recommendation, procedure, fault/fix or policy. Split multi-topic rambles into separate cards; merge repetition.`,
    `2. Title ≤ 80 chars, specific and searchable (include model numbers, needle systems, thread sizes verbatim — "LU-2810", "135x17", "Tex 92").`,
    `3. Content: clean written Australian English, 1–5 sentences, keeps ALL technical specifics (numbers, sizes, prices, brand names) exactly as said. Never invent details that weren't said.`,
    `4. Tags: 2-5 lowercase kebab-case from the trade domain (e.g. "needles", "thread", "canvas", "troubleshooting", "policy", "juki", "servicing").`,
    `5. Visibility: "public" only for generic trade knowledge safe on the website; "internal" for anything about SMA pricing, policies, suppliers, opinions of brands, or customers.`,
    `6. Skip filler, greetings, and anything with zero knowledge content. If nothing is distillable, return an empty cards array.`,
    `7. Never include customer names or personal details in card content.`,
  ].join('\n')
}

export function distillUser(transcript: string, context: 'blurt' | 'teach_session' | 'correction'): string {
  const framing =
    context === 'correction'
      ? `Tony corrected a wrong answer the assistant gave. Distil the CORRECT knowledge (what should have been said), not a description of the mistake.`
      : context === 'teach_session'
        ? `Transcript of a teach interview with Tony (interviewer questions included — distil only Tony's knowledge, not the questions).`
        : `Tony hit the brain-dump button and said this:`
  return `${framing}\n\n---\n${transcript}\n---`
}

/** JSON schema for the distillation output (structured outputs). */
export const DISTILL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'content', 'tags', 'visibility'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          visibility: { type: 'string', enum: ['internal', 'public'] },
        },
      },
    },
  },
}
