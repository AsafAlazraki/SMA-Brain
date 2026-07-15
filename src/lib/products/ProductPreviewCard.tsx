export type ProductPreview = {
  id: string
  sku?: string | null
  brand?: string | null
  model?: string | null
  name: string
  price_ex_gst?: number | null
  url?: string | null
  image_url?: string | null
  fit_note?: string | null
}

/** ex-GST → inc-GST (Australian GST is 10%). */
function incGst(ex: number): number {
  return Math.round(ex * 1.1 * 100) / 100
}
const money = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })

/**
 * A product the Brain recommended — a real preview from the SMA website: its
 * own photo, the price ex + inc GST, and a tap straight through to the product
 * page. Used in the chat answer and popped onto the call screen when she names
 * a product.
 */
export function ProductPreviewCard({ p, compact }: { p: ProductPreview; compact?: boolean }) {
  // the catalogue `name` usually already leads with brand + model, so only
  // prefix them when the name doesn't already contain the model — avoids
  // "SMA JW28BL-30 SMA JW28BL-30"
  const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()
  const showModel = p.model && !norm(p.name).includes(norm(p.model))
  return (
    <a
      href={p.url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="plate group flex items-stretch gap-3 rounded-md p-2.5 text-left transition hover:!border-safety-500/60"
    >
      {p.image_url && (
        <span className="flex h-[74px] w-[74px] shrink-0 items-center justify-center overflow-hidden rounded bg-white/95">
          <img src={p.image_url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" draggable={false} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex items-baseline justify-between gap-2">
          <span className="stamp !text-denim-400">{p.sku || 'CATALOGUE'}</span>
          <span className="stamp shrink-0 text-cloth-500 opacity-0 transition group-hover:opacity-100">View on our site ↗</span>
        </span>
        <span className="mt-0.5 truncate text-[15px] font-semibold text-cloth-100">
          {showModel && <span className="font-mono text-denim-300">{p.model} </span>}
          {p.name}
        </span>
        {p.price_ex_gst != null ? (
          <span className="mt-1 flex items-baseline gap-2">
            <span className="rounded-sm bg-safety-500 px-2 py-0.5 font-mono text-[13px] font-semibold text-safety-950">${money(p.price_ex_gst)}</span>
            <span className="stamp !text-cloth-500">ex GST</span>
            <span className="font-mono text-[12px] text-cloth-400">${money(incGst(p.price_ex_gst))} inc</span>
          </span>
        ) : (
          <span className="mt-1 stamp !text-cloth-500">Ring for price — (07) 3298 5320</span>
        )}
        {!compact && p.fit_note && <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-cloth-400">{p.fit_note}</span>}
      </span>
    </a>
  )
}
