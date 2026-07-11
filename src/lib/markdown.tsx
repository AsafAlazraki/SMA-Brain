import { Fragment, type ReactNode } from 'react'

/**
 * Tiny markdown renderer for streamed answers: paragraphs, bullet/numbered
 * lists, **bold**, *italic*, `code`. Renders React nodes (no innerHTML, no
 * sanitiser needed) and tolerates half-streamed input. S4 may replace this
 * with a full renderer if answers outgrow it.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // longest-marker-first so ** wins over *
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**')) nodes.push(<strong key={key} className="font-bold text-cloth-100">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) nodes.push(<code key={key} className="font-mono text-[0.92em] text-denim-300">{tok.slice(1, -1)}</code>)
    else nodes.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = m.index! + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  let key = 0

  const flushPara = () => {
    if (para.length === 0) return
    const k = `p${key++}`
    blocks.push(
      <p key={k} className="my-0">
        {para.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(line, `${k}-${i}`)}
          </Fragment>
        ))}
      </p>,
    )
    para = []
  }
  const flushList = () => {
    if (!list) return
    const k = `l${key++}`
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `${k}-${i}`)}</li>)
    blocks.push(
      list.ordered
        ? <ol key={k} className="my-0 list-decimal space-y-1 pl-5">{items}</ol>
        : <ul key={k} className="my-0 list-disc space-y-1 pl-5">{items}</ul>,
    )
    list = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushPara()
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? numbered)![1]!)
    } else if (line.trim() === '') {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()

  return <div className="space-y-2.5">{blocks}</div>
}
