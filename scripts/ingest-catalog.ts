/**
 * S2 — Catalog ingestion: scrape sewingmachinesaustralia.com.au (Joomla + VirtueMart)
 * into the hosted Supabase `products` table.
 *
 * Site shape (verified 2026-07):
 * - /shop/machines-we-sell → industry categories → machine pages. Machines are
 *   VirtueMart CATEGORIES (rich `category_description`, no price) — each leaf
 *   category under machines-we-sell is recorded as one product row.
 * - /shop/buy-spare-parts → brand → model categories listing part products (.html).
 * - /shop/buy-accessories → type categories (needles, threads, motors, …) → products.
 * - Listing tiles carry name/url/image/price; prices render ex-GST with an explicit
 *   "+ GST = $x" label. Default display-number is 1000, so no real pagination.
 *
 * Behaviour:
 * - Polite: robots.txt honoured (aborts if /shop is disallowed), ≥1.2s between
 *   requests, custom User-Agent.
 * - Idempotent/resumable: upsert keyed by url (select-by-url then insert/update);
 *   unchanged rows are skipped. Detail-page enrichment (descriptions/SKUs for
 *   parts & accessories) marks specs.detail_scraped so later runs continue where
 *   the page cap stopped this one.
 * - Safety valve: hard cap of 800 fetched pages per run; truncation is logged.
 *
 * Usage: npm run ingest:catalog  (env: SUPABASE_URL|VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */
import './lib/load-env'
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://www.sewingmachinesaustralia.com.au'
const USER_AGENT = 'SMABrainBot/1.0 (internal catalog sync)'
const REQUEST_DELAY_MS = 1200
const PAGE_CAP = 800
const FETCH_TIMEOUT_MS = 30_000

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.')
  process.exit(1)
}
const db = createClient(url, key)

// ---------- shared state ----------

let pagesFetched = 0
let lastRequestAt = 0
const errors: string[] = []
let capTruncated = false

type Section = 'machines' | 'parts' | 'accessories'
const SECTIONS: Array<{ section: Section; path: string; title: string }> = [
  { section: 'machines', path: '/shop/machines-we-sell', title: 'Machines We Sell' },
  { section: 'parts', path: '/shop/buy-spare-parts', title: 'Buy Spare Parts' },
  { section: 'accessories', path: '/shop/buy-accessories', title: 'Buy Accessories' },
]

interface SectionStats {
  categories: number
  new: number
  updated: number
  unchanged: number
}
const stats: Record<Section, SectionStats> = {
  machines: { categories: 0, new: 0, updated: 0, unchanged: 0 },
  parts: { categories: 0, new: 0, updated: 0, unchanged: 0 },
  accessories: { categories: 0, new: 0, updated: 0, unchanged: 0 },
}

// ---------- politeness ----------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(path: string): Promise<string> {
  const wait = lastRequestAt + REQUEST_DELAY_MS - Date.now()
  if (wait > 0) await sleep(wait)
  for (let attempt = 1; ; attempt++) {
    lastRequestAt = Date.now()
    try {
      const res = await fetch(BASE + path, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      pagesFetched++
      return await res.text()
    } catch (err) {
      if (attempt >= 2) throw err
      await sleep(3000) // one retry after a breather
    }
  }
}

// ---------- robots.txt ----------

interface RobotsRules {
  disallow: string[]
}

async function fetchRobots(): Promise<RobotsRules> {
  const text = await fetchPage('/robots.txt')
  const disallow: string[] = []
  let applies = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const field = (m[1] ?? '').toLowerCase()
    const value = (m[2] ?? '').trim()
    if (field === 'user-agent') {
      applies = value === '*' || value.toLowerCase().includes('smabrainbot')
    } else if (applies && field === 'disallow' && value) {
      disallow.push(value)
    }
  }
  return { disallow }
}

function robotsAllows(rules: RobotsRules, path: string): boolean {
  return !rules.disallow.some((prefix) => path.startsWith(prefix))
}

// ---------- HTML helpers (plain regex; VirtueMart templates are rigid) ----------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', hellip: '…', deg: '°',
  frac12: '½', frac14: '¼', trade: '™', copy: '©', reg: '®',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED_ENTITIES[name] ?? whole)
}

/** Strip tags to readable text, preserving paragraph-ish breaks. */
function htmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, i, arr) => line !== '' || arr[i - 1] !== '')
    .join('\n')
    .trim()
}

function cleanName(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function absoluteUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) return src
  if (src.startsWith('/')) return BASE + src
  return `${BASE}/${src}`
}

/** Normalise an in-site href to a path, or null if off-site/noise. */
function normalisePath(href: string): string | null {
  const raw = decodeEntities(href.trim())
  if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) return null
  let path: string
  try {
    const u = new URL(raw, BASE)
    if (u.hostname !== new URL(BASE).hostname) return null
    path = u.pathname
  } catch {
    return null
  }
  if (path.length > 1) path = path.replace(/\/+$/, '')
  // VirtueMart sort/pagination variants — same content, different order/slice
  if (/\/(by,|results,|dirAsc|dirDesc)/.test(path)) return null
  if (!path.startsWith('/shop')) return null
  return path
}

/** Main browse-view region of a category page (excludes sidebar modules). */
function mainContent(html: string): string {
  const start = html.indexOf('class="item-page"')
  const end = html.indexOf('<!-- end browse-view -->')
  if (start === -1) return ''
  return html.slice(start, end === -1 ? undefined : end)
}

interface Tile {
  path: string
  title: string
  image: string | null
}

/** Sub-category tiles: <div class="category floatleft ..."> blocks. */
function parseCategoryTiles(main: string): Tile[] {
  const tiles: Tile[] = []
  for (const chunk of main.split('<div class="category floatleft').slice(1)) {
    const link = /<a href="([^"]+)"\s+title="([^"]*)"/.exec(chunk)
    if (!link) continue
    const path = normalisePath(link[1] ?? '')
    if (!path) continue
    const img = /<img src="([^"]+)"/.exec(chunk)
    tiles.push({
      path,
      title: cleanName(link[2] ?? '') || path.split('/').pop() || path,
      image: img?.[1] ? absoluteUrl(decodeEntities(img[1])) : null,
    })
  }
  return tiles
}

interface PriceInfo {
  exGst: number | null
  incGst: number | null
  note: string | null
}

const NO_PRICE: PriceInfo = { exGst: null, incGst: null, note: null }

function parseMoney(text: string): number | null {
  const m = /\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(text)
  if (!m) return null
  const n = Number((m[1] ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * VirtueMart price block → ex-GST figure.
 * - class *WithoutTax / a "+ GST = $x" label → price is ex GST (record as-is)
 * - class *WithTax / an "incl GST" label → divide by 1.1, note the derivation
 * - otherwise → record as displayed and note the ambiguity in specs.price_note
 */
function parsePrice(scope: string): PriceInfo {
  const spans = [...scope.matchAll(/<span class="(Price[A-Za-z]+)">\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g)]
  const pick =
    spans.find((s) => (s[1] ?? '').includes('salesPrice')) ??
    spans.find((s) => (s[1] ?? '').includes('discountedPrice')) ??
    spans[0]
  if (!pick) return NO_PRICE
  const cls = pick[1] ?? ''
  const value = Number((pick[2] ?? '').replace(/,/g, ''))
  if (!Number.isFinite(value)) return NO_PRICE
  const taxDesc = /class="TaxDesc">([^<]*)/.exec(scope)?.[1]?.trim() ?? ''
  const labelledEx = cls.includes('WithoutTax') || /\+\s*GST/i.test(taxDesc)
  const labelledInc = cls.includes('WithTax') || /incl?\.?\s*GST/i.test(taxDesc)
  if (labelledEx) {
    const inc = /\+\s*GST\s*=/.test(taxDesc) ? parseMoney(taxDesc.split('=')[1] ?? '') : null
    return { exGst: value, incGst: inc, note: null }
  }
  if (labelledInc) {
    return {
      exGst: Math.round((value / 1.1) * 100) / 100,
      incGst: value,
      note: 'derived from inc-GST display price (/1.1)',
    }
  }
  return { exGst: value, incGst: null, note: 'GST labelling unclear; stored as displayed' }
}

interface ProductTile {
  path: string
  name: string
  image: string | null
  price: PriceInfo
}

/** Product tiles: <div class="product vm-col ..."> blocks on category listings. */
function parseProductTiles(main: string): ProductTile[] {
  const tiles: ProductTile[] = []
  for (const chunk of main.split('<div class="product vm-col').slice(1)) {
    const link =
      /<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/.exec(chunk) ??
      /<a title="([^"]*)" href="([^"]+)"/.exec(chunk)
    if (!link) continue
    const viaH2 = link[0].startsWith('<h2>')
    const path = normalisePath((viaH2 ? link[1] : link[2]) ?? '')
    const name = cleanName((viaH2 ? link[2] : link[1]) ?? '')
    if (!path || !name) continue
    const img = /<img src="([^"]+)"[^>]*class="browseProductImage"/.exec(chunk) ?? /<img src="([^"]+)"/.exec(chunk)
    tiles.push({
      path,
      name,
      image: img?.[1] ? absoluteUrl(decodeEntities(img[1])) : null,
      price: parsePrice(chunk),
    })
  }
  return tiles
}

/** category_description block (machine pages carry the whole pitch here). */
function parseCategoryDescription(main: string): { text: string | null; image: string | null } {
  const start = main.indexOf('class="category_description">')
  if (start === -1) return { text: null, image: null }
  const from = start + 'class="category_description">'.length
  const boundary = main.indexOf('<div class="category-view">', from)
  const raw = main.slice(from, boundary === -1 ? undefined : boundary)
  // first real photo — skip enquiry buttons / click icons
  const img = [...raw.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((m) => m[1] ?? '')
    .find((src) => src.includes('/images/') && !/click_here_icons|button|icon/i.test(src))
  const text = htmlToText(raw)
  return {
    text: text.length >= 40 ? text : null,
    image: img ? absoluteUrl(decodeEntities(img)) : null,
  }
}

interface DetailData {
  name: string | null
  description: string | null
  image: string | null
  sku: string | null
  price: PriceInfo
}

/** Product detail (.html) page → full description, main image, sku, price. */
function parseDetailPage(html: string): DetailData {
  const start = html.indexOf('productdetails-view')
  const end = html.indexOf('id="column-2"')
  const scope = start === -1 ? html : html.slice(start, end === -1 ? undefined : end)

  const name = /<h1 itemprop="name">([^<]*)<\/h1>/.exec(scope)?.[1]
  const short = /<div class="product-short-description">([\s\S]*?)<\/div>/.exec(scope)?.[1]
  let long: string | null = null
  const longStart = scope.indexOf('class="product-description"')
  if (longStart !== -1) {
    const from = scope.indexOf('>', longStart) + 1
    const to = scope.indexOf('<script', from)
    long = scope.slice(from, to === -1 ? undefined : to)
  }
  const descParts = [short, long]
    .map((part) => (part ? htmlToText(part).replace(/^Description\s*\n?/, '') : ''))
    .filter(Boolean)
  // short description is usually the long one's first paragraph — drop the dupe
  const description =
    descParts.length === 2 && descParts[1]!.startsWith(descParts[0]!.slice(0, 60))
      ? descParts[1]!
      : descParts.join('\n\n') || null

  const image =
    /rel='vm-additional-images' href="([^"]+)"/.exec(scope)?.[1] ??
    /<div class="main-image">[\s\S]*?<img src="([^"]+)"/.exec(scope)?.[1] ??
    null
  const sku =
    /class="[^"]*product[-_]sku[^"]*"[^>]*>\s*([^<\s][^<]*?)\s*</i.exec(scope)?.[1] ??
    /Product\s+SKU:?\s*(?:<[^>]+>\s*)*([A-Za-z0-9][A-Za-z0-9 ._/-]{0,40})/i.exec(scope)?.[1] ??
    null

  let price = parsePrice(scope)
  let ldName: string | null = null
  let ldImage: string | null = null
  let ldDescription: string | null = null
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (ld) {
    try {
      const data = JSON.parse(ld) as {
        name?: string
        image?: string
        description?: string
        offers?: { price?: string | number }
      }
      ldName = data.name?.trim() || null
      ldImage = data.image?.trim() || null
      ldDescription = data.description?.trim() || null
      const ldPrice = Number(data.offers?.price)
      if (price.exGst === null && Number.isFinite(ldPrice) && ldPrice > 0) {
        price = { exGst: ldPrice, incGst: null, note: 'price from structured data; GST labelling unclear' }
      }
    } catch {
      /* malformed JSON-LD — ignore */
    }
  }

  return {
    name: name ? cleanName(name) : ldName,
    description: description ?? ldDescription,
    image: image ? absoluteUrl(decodeEntities(image)) : ldImage,
    sku: sku ? decodeEntities(sku).trim() : null,
    price,
  }
}

// ---------- brand / model parsing ----------

/** Longest-first so "Durkopp Adler" wins over "Adler". */
const BRANDS = [
  'Durkopp Adler', 'Union Special', 'Golden Wheel', 'Groz-Beckert',
  'Juki', 'Brother', 'Seiko', 'Siruba', 'Newlong', 'Typical', 'Adler', 'SMA',
  'Gemsy', 'Pfaff', 'Singer', 'Mitsubishi', 'Yamato', 'Kansai', 'Pegasus',
  'Rimoldi', 'Bernina', 'Consew', 'Zoje', 'Jack', 'Buraschi', 'Baoma',
  'Excel', 'Galkin', 'Janome', 'Elna', 'Husqvarna', 'Toyota', 'Highlead',
  'Eastman', 'Coats', 'Schmetz', 'Organ', 'Tony',
].sort((a, b) => b.length - a.length)

function parseBrandModel(name: string, trail: string[]): { brand: string | null; model: string | null } {
  let brand: string | null = null
  let rest = ''
  for (const candidate of BRANDS) {
    if (name.toLowerCase().startsWith(candidate.toLowerCase() + ' ')) {
      brand = candidate
      rest = name.slice(candidate.length).trim()
      break
    }
  }
  if (!brand) {
    // fall back to a brand named in the category trail (parts tree is brand → model)
    for (const segment of trail) {
      const hit = BRANDS.find(
        (candidate) => segment.toLowerCase() === candidate.toLowerCase() ||
          segment.toLowerCase().startsWith(candidate.toLowerCase() + ' '),
      )
      if (hit) {
        brand = hit
        break
      }
    }
    return { brand, model: null }
  }
  // model = leading run of code-like tokens ("LU-2810", "DB2-B798", "867-M")
  const tokens = rest.split(/\s+/)
  const code: string[] = []
  for (const token of tokens) {
    if (/\d/.test(token) || /^[A-Z][A-Z0-9/-]{0,7}$/.test(token)) code.push(token)
    else break
  }
  const model = code.length > 0 && /\d/.test(code.join(' ')) ? code.join(' ') : null
  return { brand, model }
}

// ---------- database upsert (keyed by url — no unique constraint, so select-then-write) ----------

interface ProductRow {
  url: string
  name: string
  brand: string | null
  model: string | null
  category: string | null
  industries: string[]
  price_ex_gst: number | null
  currency: string
  specs: Record<string, unknown>
  description: string | null
  image_url: string | null
  sku: string | null
  status: string
  source: string
}

interface ExistingRow extends ProductRow {
  id: string
}

const SELECT_COLS =
  'id, url, name, brand, model, category, industries, price_ex_gst, currency, specs, description, image_url, sku, status, source'

type UpsertResult = 'new' | 'updated' | 'unchanged' | 'error'

function rowsEqual(a: ProductRow, b: ProductRow): boolean {
  const shape = (r: ProductRow) => ({
    name: r.name,
    brand: r.brand,
    model: r.model,
    category: r.category,
    industries: r.industries,
    price: r.price_ex_gst === null ? null : Number(r.price_ex_gst),
    description: r.description,
    image_url: r.image_url,
    sku: r.sku,
    specs: r.specs,
    status: r.status,
    source: r.source,
  })
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b))
}

/** In-run cache so a product tiled in two categories is written once. */
const seenThisRun = new Map<string, { id: string; detailScraped: boolean }>()

async function upsertProduct(row: ProductRow): Promise<UpsertResult> {
  const { data: existing, error: selErr } = await db
    .from('products')
    .select(SELECT_COLS)
    .eq('url', row.url)
    .maybeSingle<ExistingRow>()
  if (selErr) {
    errors.push(`select ${row.url}: ${selErr.message}`)
    return 'error'
  }

  if (!existing) {
    const insertRow = { ...row, scraped_at: new Date().toISOString() }
    let { data: created, error } = await db.from('products').insert(insertRow).select('id').single()
    if (error && error.code === '23505' && row.sku) {
      // sku carries a UNIQUE constraint; visible SKUs aren't guaranteed unique on-site
      const retry = await db
        .from('products')
        .insert({ ...insertRow, sku: null, specs: { ...row.specs, sku_conflict: row.sku } })
        .select('id')
        .single()
      created = retry.data
      error = retry.error
    }
    if (error || !created) {
      errors.push(`insert ${row.url}: ${error?.message ?? 'no row returned'}`)
      return 'error'
    }
    seenThisRun.set(row.url, { id: created.id, detailScraped: row.specs.detail_scraped === true })
    return 'new'
  }

  // never clobber richer data with thinner listing-tile data
  const merged: ProductRow = {
    ...row,
    description: row.description ?? existing.description,
    image_url: row.image_url ?? existing.image_url,
    sku: row.sku ?? existing.sku,
    brand: row.brand ?? existing.brand,
    model: row.model ?? existing.model,
    price_ex_gst: row.price_ex_gst ?? existing.price_ex_gst,
    specs: { ...(existing.specs ?? {}), ...row.specs },
  }
  seenThisRun.set(row.url, { id: existing.id, detailScraped: merged.specs.detail_scraped === true })
  if (rowsEqual(merged, existing)) return 'unchanged'
  const { error } = await db
    .from('products')
    .update({ ...merged, scraped_at: new Date().toISOString() })
    .eq('id', existing.id)
  if (error) {
    errors.push(`update ${row.url}: ${error.message}`)
    return 'error'
  }
  return 'updated'
}

// ---------- crawl ----------

interface QueueItem {
  path: string
  title: string
  trail: string[] // human-readable path, e.g. ['Machines We Sell', 'Canvas & Upholstery']
  image: string | null
}

function bump(section: Section, result: UpsertResult): void {
  if (result === 'new') stats[section].new++
  else if (result === 'updated') stats[section].updated++
  else if (result === 'unchanged') stats[section].unchanged++
}

async function crawlSection(seed: { section: Section; path: string; title: string }, rules: RobotsRules): Promise<void> {
  const { section } = seed
  const queue: QueueItem[] = [{ path: seed.path, title: seed.title, trail: [seed.title], image: null }]
  const visited = new Set<string>()

  while (queue.length > 0) {
    if (pagesFetched >= PAGE_CAP) {
      capTruncated = true
      console.log(`! page cap (${PAGE_CAP}) hit with ${queue.length} ${section} categories still queued`)
      return
    }
    const item = queue.shift()!
    if (visited.has(item.path)) continue
    visited.add(item.path)
    if (!robotsAllows(rules, item.path)) {
      console.log(`! robots.txt disallows ${item.path} — skipped`)
      continue
    }

    let html: string
    try {
      html = await fetchPage(item.path)
    } catch (err) {
      errors.push(`fetch ${item.path}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    stats[section].categories++
    const main = mainContent(html)
    const subcats = parseCategoryTiles(main)
    const products = parseProductTiles(main)

    for (const sub of subcats) {
      if (!visited.has(sub.path)) {
        queue.push({ path: sub.path, title: sub.title, trail: [...item.trail, sub.title], image: sub.image })
      }
    }

    const industries = section === 'machines' && item.trail.length >= 2 ? [item.trail[1]!] : []
    const tally = { new: 0, updated: 0, unchanged: 0 }

    // depth ≥ 3 ("Machines We Sell > <industry> > <machine>"): first-level leaves
    // like "Second Hand Machinery" are info pages, not machines
    if (subcats.length === 0 && products.length === 0 && section === 'machines' && item.trail.length >= 3) {
      // leaf category under machines-we-sell = one machine (description page, no price)
      const desc = parseCategoryDescription(main)
      const { brand, model } = parseBrandModel(item.title, item.trail)
      const result = await upsertProduct({
        url: BASE + item.path,
        name: item.title,
        brand,
        model,
        category: item.trail.slice(0, -1).join(' > '),
        industries,
        price_ex_gst: null,
        currency: 'AUD',
        specs: { detail_scraped: true },
        description: desc.text,
        image_url: desc.image ?? item.image,
        sku: null,
        status: 'active',
        source: 'scrape',
      })
      bump(section, result)
      console.log(`[${section}] ${item.trail.join(' > ')}: machine card (${result}${desc.text ? `, desc ${desc.text.length} chars` : ', no description'})`)
      continue
    }

    for (const product of products) {
      const productUrl = BASE + product.path
      if (seenThisRun.has(productUrl)) continue
      const { brand, model } = parseBrandModel(product.name, item.trail)
      const specs: Record<string, unknown> = {}
      if (product.price.note) specs.price_note = product.price.note
      if (product.price.incGst !== null) specs.price_inc_gst = product.price.incGst
      if (section === 'parts' && item.trail.length >= 3) specs.for_machine = item.trail[item.trail.length - 1]
      const result = await upsertProduct({
        url: productUrl,
        name: product.name,
        brand,
        model,
        category: item.trail.join(' > '),
        industries,
        price_ex_gst: product.price.exGst,
        currency: 'AUD',
        specs,
        description: null,
        image_url: product.image,
        sku: null,
        status: 'active',
        source: 'scrape',
      })
      bump(section, result)
      if (result === 'new') tally.new++
      else if (result === 'updated') tally.updated++
      else if (result === 'unchanged') tally.unchanged++
    }

    console.log(
      `[${section}] ${item.trail.join(' > ')}: ${subcats.length} subcats, ${products.length} products` +
        (products.length > 0 ? ` (${tally.new} new, ${tally.updated} updated, ${tally.unchanged} unchanged)` : ''),
    )
  }
}

/** Spend leftover page budget on .html detail pages that still lack descriptions. */
async function enrichDetails(rules: RobotsRules): Promise<{ enriched: number; pending: number }> {
  const candidates = [...seenThisRun.entries()]
    .filter(([candidateUrl, meta]) => candidateUrl.endsWith('.html') && !meta.detailScraped)
    .map(([candidateUrl]) => candidateUrl)
    .sort()
  let enriched = 0
  let index = 0
  console.log(`\nEnrichment: ${candidates.length} products lack detail-page data; budget ${Math.max(0, PAGE_CAP - pagesFetched)} pages`)
  for (const productUrl of candidates) {
    if (pagesFetched >= PAGE_CAP) {
      capTruncated = true
      break
    }
    index++
    const path = productUrl.slice(BASE.length)
    if (!robotsAllows(rules, path)) continue
    try {
      const html = await fetchPage(path)
      const detail = parseDetailPage(html)
      const meta = seenThisRun.get(productUrl)!
      const patch: Record<string, unknown> = { scraped_at: new Date().toISOString() }
      if (detail.description) patch.description = detail.description
      if (detail.image) patch.image_url = detail.image
      if (detail.price.exGst !== null) patch.price_ex_gst = detail.price.exGst
      const { data: current } = await db.from('products').select('specs, sku').eq('id', meta.id).maybeSingle<{ specs: Record<string, unknown>; sku: string | null }>()
      const specs: Record<string, unknown> = { ...(current?.specs ?? {}), detail_scraped: true }
      if (detail.price.note) specs.price_note = detail.price.note
      if (detail.price.incGst !== null) specs.price_inc_gst = detail.price.incGst
      patch.specs = specs
      if (detail.sku && !current?.sku) patch.sku = detail.sku
      let { error } = await db.from('products').update(patch).eq('id', meta.id)
      if (error && error.code === '23505' && patch.sku) {
        specs.sku_conflict = patch.sku
        delete patch.sku
        patch.specs = specs
        error = (await db.from('products').update(patch).eq('id', meta.id)).error
      }
      if (error) errors.push(`enrich ${productUrl}: ${error.message}`)
      else enriched++
    } catch (err) {
      errors.push(`enrich ${productUrl}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (index % 25 === 0) console.log(`  … enriched ${enriched}/${index} of ${candidates.length}`)
  }
  return { enriched, pending: candidates.length - enriched }
}

// ---------- main ----------

async function main(): Promise<void> {
  console.log(`Catalog ingest — ${BASE} → products table (cap ${PAGE_CAP} pages, ${REQUEST_DELAY_MS}ms delay)\n`)

  const rules = await fetchRobots()
  for (const seed of SECTIONS) {
    if (!robotsAllows(rules, seed.path)) {
      console.error(`robots.txt disallows ${seed.path} — stopping without crawling.`)
      process.exit(1)
    }
  }
  console.log(`robots.txt OK (${rules.disallow.length} disallow rules; /shop permitted)\n`)

  for (const seed of SECTIONS) {
    await crawlSection(seed, rules)
  }

  const { enriched, pending } = await enrichDetails(rules)

  const totals = Object.values(stats).reduce(
    (acc, s) => ({ new: acc.new + s.new, updated: acc.updated + s.updated, unchanged: acc.unchanged + s.unchanged }),
    { new: 0, updated: 0, unchanged: 0 },
  )
  console.log('\n---')
  for (const seed of SECTIONS) {
    const s = stats[seed.section]
    console.log(`${seed.section}: ${s.categories} category pages, ${s.new} new, ${s.updated} updated, ${s.unchanged} unchanged`)
  }
  console.log(`detail enrichment: ${enriched} products enriched, ${pending} still pending (next run continues)`)
  if (capTruncated) console.log(`! run truncated by the ${PAGE_CAP}-page safety cap — re-run to continue`)
  console.log(
    `\n${totals.new + totals.updated + totals.unchanged} products upserted (${totals.new} new, ${totals.updated} updated, ${totals.unchanged} unchanged), ` +
      `${pagesFetched} pages fetched, errors: ${errors.length === 0 ? 'none' : `[${errors.slice(0, 15).join(' | ')}${errors.length > 15 ? ` … +${errors.length - 15} more` : ''}]`}`,
  )
}

void main()
