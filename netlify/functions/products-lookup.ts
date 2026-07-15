import type { Config } from '@netlify/functions'
import { jsonResponse } from './lib/sse'
import { authenticate } from './lib/auth'
import { searchProducts } from './lib/retrieval'

/**
 * Look up products by a free-text query (a model number, a name) → top matches
 * with image + price + website URL. Used by the live call to pop a product
 * preview on screen when the Brain names a product she just mentioned aloud.
 * Authed; returns only the fields the preview card needs.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req)
  if (auth.failure) return auth.failure

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return jsonResponse(200, { products: [] })

  try {
    const hits = await searchProducts(q, 4)
    const products = hits
      .filter((p) => p.image_url) // only show ones we can actually preview
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        brand: p.brand,
        model: p.model,
        name: p.name,
        price_ex_gst: p.price_ex_gst,
        url: p.url,
        image_url: p.image_url,
      }))
    return jsonResponse(200, { products })
  } catch (err) {
    return jsonResponse(502, { error: String(err) })
  }
}

export const config: Config = { path: '/api/products/lookup' }
