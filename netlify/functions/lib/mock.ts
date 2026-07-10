/**
 * Mock brain content — lets the whole app run with ZERO keys/db for local demo.
 * Drawn from the real research corpus (docs/knowledge/). Replaced by Supabase + real
 * catalog in S2; kept for tests and offline dev.
 */

export type MockKnowledge = {
  id: string
  title: string
  content: string
  tags: string[]
  visibility: string
  _keywords: string[]
}

export type MockProduct = {
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
  _keywords: string[]
}

export const MOCK_KNOWLEDGE: MockKnowledge[] = [
  {
    id: 'k-shade-sails',
    title: 'Shade sails: recommended setup',
    content:
      'Shade sail work is long-arm walking foot territory — the SMA K6-20 long arm handles bulk HDPE mesh and canvas. Thread: UV-stable bonded polyester V92–V138; for lifetime warranty jobs spec PTFE (Tenara-class, Tex 92) which is UV-immune. Needles: 135x17 in 20/125–24/180 depending on thread size.',
    tags: ['shade-sails', 'canvas', 'machine-selection'],
    visibility: 'public',
    _keywords: ['shade', 'sail', 'sails', 'canvas', 'mesh', 'hdpe', 'outdoor'],
  },
  {
    id: 'k-lu2810-needle',
    title: 'Juki LU-2810 needle system',
    content:
      'The Juki LU-2810 walking foot (compound feed) takes needle system 135x17 (DPx17). Common sizes 16/100 through 23/160 matched to thread: V69 → 16/100–18/110, V92 → 19/120, V138 → 22/140–23/160.',
    tags: ['juki', 'lu-2810', 'needles'],
    visibility: 'public',
    _keywords: ['lu-2810', 'lu2810', 'juki', 'needle', 'system', '135x17'],
  },
  {
    id: 'k-skipped-stitches',
    title: 'Skipped stitches: first checks',
    content:
      'Skipped stitches on walking foot machines: (1) wrong needle system or size for the thread — check 135x17 and size up for heavy thread; (2) needle in backwards or bent; (3) needle deflection on thick seams — go up a size; (4) hook timing drifted — book a service if basics check out. On K6s sewing horse rugs, cheap bonded nylon under Tex 90 is a known culprit.',
    tags: ['troubleshooting', 'skipped-stitches', 'walking-foot', 'k6'],
    visibility: 'public',
    _keywords: ['skip', 'skipped', 'stitch', 'stitches', 'k6', 'horse', 'rug', 'rugs', 'timing'],
  },
  {
    id: 'k-tex92',
    title: 'Tex 92 thread: needle pairing',
    content: 'Tex 92 (V92) bonded polyester pairs with a 19/120 needle (system per machine — 135x17 on walking foot). On canvas, V92 suits mid-weight work; step up to V138 + 22/140 for heavy webbing or multi-layer corners.',
    tags: ['thread', 'needles', 'canvas'],
    visibility: 'public',
    _keywords: ['tex', '92', 'v92', 'thread', 'needle', 'canvas'],
  },
  {
    id: 'k-warranty-secondhand',
    title: 'Second-hand machine warranty (policy)',
    content: 'Second-hand machinery carries a 3-month SMA warranty, serviced and ready to use before dispatch. Extended warranty options available on request. New SMA-brand machines: 2-year machine & motor warranty (clutch motor models).',
    tags: ['policy', 'warranty', 'second-hand'],
    visibility: 'internal',
    _keywords: ['warranty', 'second', 'hand', 'secondhand', 'used', 'policy'],
  },
]

export const MOCK_PRODUCTS: MockProduct[] = [
  {
    id: 'p-k6-20',
    sku: 'SMA-K6-20',
    brand: 'SMA',
    model: 'K6-20',
    name: 'Long Arm Walking Foot Machine',
    category: 'Canvas & Upholstery',
    price_ex_gst: 3295,
    url: 'https://www.sewingmachinesaustralia.com.au/shop/machines-we-sell/canvas-upholstery',
    image_url: null,
    description: 'SMA-brand long arm walking foot — the shade sail and canvas workhorse, upgraded in-house, 2-year warranty.',
    _keywords: ['k6', 'k6-20', 'long', 'arm', 'walking', 'foot', 'canvas', 'shade', 'sail', 'upholstery'],
  },
  {
    id: 'p-lu2810',
    sku: 'JUKI-LU-2810',
    brand: 'Juki',
    model: 'LU-2810',
    name: 'Walking Foot Industrial Sewing Machine',
    category: 'Motor Trimming',
    price_ex_gst: 4890,
    url: 'https://www.sewingmachinesaustralia.com.au/shop/machines-we-sell/motor-trimming/juki-lu-2813',
    image_url: null,
    description: 'Compound feed flatbed lockstitch for upholstery and motor trimming. Needle system 135x17.',
    _keywords: ['juki', 'lu-2810', 'lu2810', 'walking', 'foot', 'upholstery', 'trimming'],
  },
  {
    id: 'p-np7a',
    sku: 'NEWLONG-NP-7A',
    brand: 'Newlong',
    model: 'NP-7A',
    name: 'Portable Bag Closer',
    category: 'Bag Closers',
    price_ex_gst: 1150,
    url: 'https://www.sewingmachinesaustralia.com.au/shop/machines-we-sell',
    image_url: null,
    description: 'Industry-standard portable bag closing machine.',
    _keywords: ['newlong', 'np-7a', 'bag', 'closer', 'closing', 'portable'],
  },
]

export const MOCK_ANSWER_NOTE =
  '\n\n_(Mock mode: no API key configured — this answer streams from canned demo content. Set ANTHROPIC_API_KEY in .env for the real brain.)_'
