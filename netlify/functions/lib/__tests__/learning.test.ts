import { describe, expect, it } from 'vitest'
import { distillToCards } from '../learning'
import { distillSystem, distillUser, DISTILL_SCHEMA } from '../prompts/distill'
import { teachSystem, teachGapsLayer } from '../prompts/teach'

describe('distillation prompts', () => {
  it('system prompt carries the load-bearing rules (jargon, visibility, no invention)', () => {
    const s = distillSystem()
    expect(s).toContain('LU-2810')
    expect(s).toContain('Never invent')
    expect(s).toContain('"internal"')
    expect(s).toContain('Australian English')
  })

  it('correction framing distils the fix, not the mistake', () => {
    expect(distillUser('x', 'correction')).toContain('CORRECT knowledge')
    expect(distillUser('x', 'teach_session')).toContain('only Tony')
  })

  it('schema demands title/content/tags/visibility per card', () => {
    const cardSchema = DISTILL_SCHEMA.properties.cards.items
    expect(cardSchema.required).toEqual(['title', 'content', 'tags', 'visibility'])
  })
})

describe('teach prompts', () => {
  it('interviewer asks one question at a time and works from gaps', () => {
    expect(teachSystem()).toContain('ONE question at a time')
    const gaps = teachGapsLayer([{ question: 'K6 skipping on rugs?', times_asked: 3 }])
    expect(gaps).toContain('K6 skipping on rugs?')
    expect(gaps).toContain('3×')
    expect(teachGapsLayer([])).toContain('breadth')
  })
})

describe('mock-mode distillation (zero-key path)', () => {
  it('splits a multi-topic blurt into separate proposals', async () => {
    const blurt = [
      'The K6 hates cheap bonded nylon under Tex 90 — tell people to use decent V92 minimum or it skips on rug seams.',
      'Second-hand overlockers get a 3-month warranty, serviced before dispatch, and we always say extended options are available.',
    ].join('\n\n')
    const cards = await distillToCards(blurt, 'blurt')
    expect(cards.length).toBe(2)
    expect(cards[0]!.title.length).toBeLessThanOrEqual(80)
    expect(cards[0]!.visibility).toBe('internal')
  })

  it('returns nothing for empty input', async () => {
    expect(await distillToCards('   ', 'blurt')).toEqual([])
  })
})
