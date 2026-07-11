import { describe, expect, it } from 'vitest'
import { encodeSSE } from '../sse'
import { cleanEmailThread, mineQuestions } from '../../draft'
import { searchKnowledge, searchProducts, orQuery } from '../retrieval'
import { identityLayer, groundingLayer, modeLayer } from '../prompts/system'

describe('sse encoding', () => {
  it('encodes event and JSON data with terminating blank line', () => {
    const s = encodeSSE('token', { text: 'hi' })
    expect(s).toBe('event: token\ndata: {"text":"hi"}\n\n')
  })
})

describe('email thread cleanup', () => {
  it('strips quoted history and finds questions', () => {
    const email = [
      'Hi guys,',
      'What needle system does the LU-2810 take? And do you have V92 thread in stock?',
      '',
      'Cheers, Dave',
      'On Mon, 6 Jul 2026 at 09:12, SMA wrote:',
      '> previous reply text',
    ].join('\n')
    const cleaned = cleanEmailThread(email)
    expect(cleaned).not.toContain('previous reply')
    const qs = mineQuestions(cleaned)
    expect(qs.length).toBe(2)
    expect(qs[0]).toContain('LU-2810')
  })
})

describe('mock retrieval (jargon round-trip)', () => {
  it('finds the LU-2810 needle card from a natural question', async () => {
    const hits = await searchKnowledge('what needle system does the LU-2810 take?')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.id).toBe('k-lu2810-needle')
  })
  it('finds shade sail guidance and the K6-20 product', async () => {
    const k = await searchKnowledge('customer sews shade sails, what do we recommend?')
    expect(k.some((h) => h.id === 'k-shade-sails')).toBe(true)
    const p = await searchProducts('shade sail machine')
    expect(p.some((h) => h.id === 'p-k6-20')).toBe(true)
  })
})

describe('FTS query building (jargon round-trip)', () => {
  it('OR-joins words so noise terms cannot zero recall', () => {
    expect(orQuery('caravan annexe machine thread setup')).toBe('caravan OR annexe OR machine OR thread OR setup')
  })
  it('keeps model numbers, needle systems and sizes intact', () => {
    const q = orQuery('needle for LU-2810 with 135x17 at 20/125?')
    expect(q).toContain('lu-2810')
    expect(q).toContain('135x17')
    expect(q).toContain('20/125')
  })
})

describe('prompt layers', () => {
  it('call mode demands answer-first brevity and grounding stays intact', () => {
    expect(modeLayer('call')).toContain('ONE short sentence')
    expect(groundingLayer()).toContain('log_gap')
    expect(identityLayer()).toContain('Sewing Machines Australia')
  })
})
