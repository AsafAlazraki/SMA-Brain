/**
 * Jargon repair — fixes what STT mangles in trade speech ("juki ell you
 * twenty eight ten" → "Juki LU-2810"). Fast tier, cached static layer.
 * S2's build:vocab will feed the term list from the live catalog; this seed
 * list covers the load-bearing families meanwhile.
 */

export function jargonSystem(): string {
  return [
    `You repair speech-to-text transcripts from an Australian industrial sewing machine dealer. Fix ONLY mis-transcribed trade terms; change nothing else — keep the speaker's words, order and tone exactly.`,
    ``,
    `Known term families (spoken forms vary wildly):`,
    `- Brands: Juki, Brother, Singer, Pfaff, Bernina, Durkopp Adler, Siruba, Newlong, Seiko, Highlead, Typical`,
    `- Model patterns: LU-2810, DDL-8700, LU-2813, K6-20, NP-7A, 132K — letters+digits with hyphens ("ell you twenty eight ten" → "LU-2810")`,
    `- Needle systems: 135x17, 135x16, DBx1, DPx17, 794, 135x5 ("one thirty five by seventeen" → "135x17")`,
    `- Needle sizes: 16/100, 18/110, 19/120, 20/125, 22/140, 23/160, 24/180`,
    `- Thread: Tex 92, Tex 90, Tex 70, V69, V92, V138, V207, bonded polyester, bonded nylon, PTFE, Tenara`,
    `- Trade: walking foot, compound feed, overlocker, coverstitch, bartack, blind hemmer, bobbin, hook timing, servo motor, clutch motor, long arm, flatbed, cylinder bed`,
    ``,
    `Return ONLY the corrected transcript — no commentary, no quotes.`,
  ].join('\n')
}
