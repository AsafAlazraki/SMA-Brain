import { createClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from './env'
import { MOCK_KNOWLEDGE, MOCK_PRODUCTS } from './mock'

export type KnowledgeHit = { id: string; title: string; content: string; tags: string[]; visibility: string; score: number }
export type ProductHit = {
  id: string
  sku: string | null
  brand: string | null
  model: string | null
  name: string
  category: string | null
  price_ex_gst: number | null
  url: string | null
  image_url: string | null
  description: string | null
  score: number
}

const service = isSupabaseConfigured ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null

/**
 * Hybrid search. With Supabase connected this calls the SQL RPCs (FTS + vector + trigram RRF).
 * Embeddings are optional at this stage — the RPCs degrade gracefully to FTS/trigram when
 * query_embedding is a zero vector (S3 wires the real embedding provider).
 */
export async function searchKnowledge(query: string, count = 8): Promise<KnowledgeHit[]> {
  if (!service) return mockSearch(MOCK_KNOWLEDGE, query, count) as unknown as KnowledgeHit[]
  const { data, error } = await service.rpc('search_knowledge', {
    query_text: query,
    query_embedding: zeroVector(),
    match_count: count,
  })
  if (error) throw new Error(`search_knowledge failed: ${error.message}`)
  return (data ?? []) as KnowledgeHit[]
}

export async function searchProducts(query: string, count = 6): Promise<ProductHit[]> {
  if (!service) return mockSearch(MOCK_PRODUCTS, query, count) as unknown as ProductHit[]
  const { data, error } = await service.rpc('search_products', {
    query_text: query,
    query_embedding: zeroVector(),
    match_count: count,
  })
  if (error) throw new Error(`search_products failed: ${error.message}`)
  return (data ?? []) as ProductHit[]
}

export async function logGap(question: string): Promise<void> {
  if (!service) return
  const normalized = question.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  // upsert-ish: bump times_asked if the same normalized question exists
  const { data } = await service.from('knowledge_gaps').select('id, times_asked').eq('normalized_question', normalized).maybeSingle()
  if (data) {
    await service.from('knowledge_gaps').update({ times_asked: data.times_asked + 1, last_asked_at: new Date().toISOString() }).eq('id', data.id)
  } else {
    await service.from('knowledge_gaps').insert({ question, normalized_question: normalized })
  }
}

function zeroVector(): string {
  return `[${new Array(768).fill(0).join(',')}]`
}

/** Naive keyword scorer for mock mode — enough to demo grounding end-to-end without a database. */
function mockSearch<T extends { _keywords: string[] }>(items: readonly T[], query: string, count: number): (Omit<T, '_keywords'> & { score: number })[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  return items
    .map((item) => {
      const { _keywords, ...rest } = item
      return {
        ...rest,
        score: terms.reduce((s, t) => s + (_keywords.some((k) => k.includes(t) || t.includes(k)) ? 1 : 0), 0),
      }
    })
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
}
