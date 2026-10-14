import { Fragment, type ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'

/**
 * The assistant's replies are plain text written by the backend: one fact per line, lists as "· " lines,
 * advice as "提示：…" / "Tip: …". This turns that text into paragraphs, a ruled list, a tip and small notes,
 * and sets amounts in figures that line up.
 */

const AMOUNT = /[+-]?¥[\d,]+(?:\.\d+)?/g
const BULLET = /^[·•-]\s+/
const TIP = /^(提示[:：]|Tip:)\s*/
const NOTE = /^(（.*）|\(.*\))$/
// a list line that leads with when it happened: "10-03 12:30 …" or "2026-10-01 …"
const DATE = /^(\d{2}-\d{2} \d{2}:\d{2}|\d{4}-\d{2}-\d{2})\s+/
// "what ¥amount" with nothing after it but a reason (": …") or a remark in brackets
const VALUE = /^(.*?)\s*([+-]?¥[\d,]+(?:\.\d+)?)\s*(?:[:：]\s*(.+)|[（(](.+)[）)])?$/
// "Name: details" with a short name in front
const LABEL = /^([^:：¥]{1,24})[:：]\s*(.+)$/
const CJK = /[一-鿿]/

type Block =
  | { kind: 'p' | 'tip' | 'note'; text: string }
  | { kind: 'list'; items: string[] }

function blocks(text: string): Block[] {
  const out: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, '')
      const last = out[out.length - 1]
      if (last?.kind === 'list') last.items.push(item)
      else out.push({ kind: 'list', items: [item] })
    } else if (TIP.test(line)) out.push({ kind: 'tip', text: line.replace(TIP, '') })
    else if (NOTE.test(line)) out.push({ kind: 'note', text: line.slice(1, -1) })
    else out.push({ kind: 'p', text: line })
  }
  return out
}

/** Amounts inside running text: tabular figures, never broken across lines. */
export function Amounts({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(AMOUNT)) {
    const start = match.index ?? 0
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<span key={start} className="num whitespace-nowrap font-semibold">{match[0]}</span>)
    at = start + match[0].length
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>
}

/** "Name: details" with the name in bold; anything else as running text. */
function Labelled({ text }: { text: string }) {
  const label = text.match(LABEL)
  if (!label) return <Amounts text={text} />
  return <><span className="font-medium">{label[1]}</span>{CJK.test(label[1]) ? '：' : ': '}<Amounts text={label[2]} /></>
}

function Item({ text }: { text: string }) {
  const date = text.match(DATE)?.[1]
  const rest = date ? text.slice(date.length).trim() : text
  const value = rest.match(VALUE)
  const when = date && <span className="num mr-2 font-mono text-xs text-ink2">{date}</span>
  if (value && value[1]) {
    const remark = value[3] ?? value[4]
    return (
      <li className="flex items-start gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="keep">{when}<Labelled text={value[1]} /></p>
          {remark && <p className="keep text-xs text-ink2">{remark}</p>}
        </div>
        <span className="num shrink-0 whitespace-nowrap font-mono">{value[2]}</span>
      </li>
    )
  }
  return <li className="keep px-3 py-2">{when}<Labelled text={rest} /></li>
}

export function ReplyText({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-[0.97rem] leading-relaxed">
      {blocks(text).map((block, i) => {
        if (block.kind === 'list') {
          return <ul key={i} className="ruled divide-y divide-[var(--rule)] bg-field text-[0.93rem] leading-snug">{block.items.map((item, j) => <Item key={j} text={item} />)}</ul>
        }
        if (block.kind === 'tip') {
          return (
            <p key={i} className="keep flex gap-2 rounded-box bg-[var(--accent-wash)] px-3 py-2 text-[0.93rem]">
              <Lightbulb size={16} className="mt-[3px] shrink-0 text-jade" aria-hidden />
              <span><Amounts text={block.text} /></span>
            </p>
          )
        }
        if (block.kind === 'note') return <p key={i} className="keep text-xs leading-normal text-ink2">{block.text}</p>
        return <p key={i} className="keep"><Amounts text={block.text} /></p>
      })}
    </div>
  )
}
