import { useState, type RefObject } from 'react'
import { PanelLeftClose, SquarePen, Trash2 } from 'lucide-react'
import type { ConversationItem } from '../api/types'
import { useLang } from '../i18n'
import { Icon } from './Icon'

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })  // 'YYYY-MM-DD', China days
const GROUPS: [string, string][] = [['Today', '今天'], ['Yesterday', '昨天'], ['Previous 7 days', '过去 7 天'], ['Older', '更早']]

function age(iso: string): number {
  const days = Math.round((Date.parse(DAY.format(new Date())) - Date.parse(DAY.format(new Date(iso)))) / 86_400_000)
  return days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3
}

type Props = {
  items: ConversationItem[] | undefined
  active: string | null
  busy: boolean
  onPick: (id: string) => void
  onNew: () => void
  onRemove: (id: string) => void
  onClose: () => void
  first?: RefObject<HTMLButtonElement>
}

/** Past chats, newest first, grouped by day. Removing one only takes it off this list: History still has it. */
export function ChatHistory({ items, active, busy, onPick, onNew, onRemove, onClose, first }: Props) {
  const { tr } = useLang()
  const [confirm, setConfirm] = useState<string | null>(null)
  const groups = GROUPS.map((label, index) => ({ label, items: (items ?? []).filter((item) => age(item.updated_at) === index) }))

  return (
    <nav aria-label={tr('Chat history', '对话记录')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 p-2">
        <button ref={first} type="button" onClick={onNew} disabled={busy} className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left text-[0.93rem] font-semibold hover:bg-paper2 disabled:opacity-50">
          <SquarePen size={17} className="text-[var(--action)]" />{tr('New chat', '新对话')}
        </button>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-ink2 hover:bg-paper2" aria-label={tr('Hide chat history', '收起对话记录')} title={tr('Hide chat history', '收起对话记录')}>
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {items === undefined && <div className="space-y-2 px-3 pt-3">{[70, 55, 80].map((w) => <div key={w} className="h-3.5 animate-pulse rounded-full bg-paper2" style={{ width: `${w}%` }} />)}</div>}
        {items?.length === 0 && <p className="px-3 pt-3 text-sm text-ink2">{tr('Your chats will appear here.', '聊过的对话会出现在这里。')}</p>}
        {groups.filter((g) => g.items.length).map((g) => (
          <section key={g.label[0]} className="mt-3 first:mt-1">
            <h2 className="px-3 pb-1 text-xs font-semibold text-ink2">{tr(...g.label)}</h2>
            <ul>
              {g.items.map((item) => confirm === item.id ? (
                <li key={item.id} className="rounded-xl bg-paper2 px-3 py-2 text-sm">
                  <p className="font-semibold">{tr('Remove from this list?', '从列表中移除？')}</p>
                  <p className="mt-0.5 text-xs text-ink2">{tr('The record stays in History.', '记录仍保留在“记录”页。')}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => { setConfirm(null); onRemove(item.id) }} className="rounded-lg bg-cinnabar px-2.5 py-1 text-xs font-semibold text-white">{tr('Remove', '移除')}</button>
                    <button type="button" onClick={() => setConfirm(null)} className="rounded-lg px-2.5 py-1 text-xs font-semibold hover:bg-field">{tr('Cancel', '取消')}</button>
                  </div>
                </li>
              ) : (
                <li key={item.id} className="group relative">
                  <button type="button" disabled={busy} onClick={() => onPick(item.id)} aria-current={item.id === active ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 rounded-xl py-2 pl-3 pr-9 text-left text-[0.93rem] disabled:cursor-wait ${item.id === active ? 'bg-paper font-semibold' : 'hover:bg-paper2'}`}>
                    <span className="truncate">{item.title || tr('Untitled chat', '未命名对话')}</span>
                    {item.escalated && <Icon name="users" size={13} className="shrink-0 text-ink2" />}
                  </button>
                  <button type="button" onClick={() => setConfirm(item.id)} aria-label={tr(`Remove “${item.title}” from the list`, `从列表移除“${item.title}”`)} title={tr('Remove from list', '从列表移除')}
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink2 hover:bg-field hover:text-cinnabar focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )
}
