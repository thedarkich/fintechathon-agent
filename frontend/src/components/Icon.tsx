import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Bell,
  Bot,
  Bus,
  ChartColumn,
  Check,
  CircleEllipsis,
  Clapperboard,
  Clock,
  CreditCard,
  FileText,
  Flag,
  Gift,
  HeartPulse,
  House,
  Inbox,
  Landmark,
  LayoutGrid,
  Lock,
  MessageSquareText,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Search,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Tv,
  Upload,
  Users,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { categoryColor } from '../lib/format'

export type IconName =
  | 'grid' | 'inbox' | 'agents' | 'shield' | 'arrow' | 'wallet' | 'activity' | 'upload' | 'clock' | 'file' | 'search' | 'check' | 'flag'
  | 'chat' | 'bank' | 'chart' | 'trend' | 'card' | 'bell' | 'lock' | 'phone' | 'receipt' | 'users'
  | 'send' | 'home'

const icons: Record<IconName, LucideIcon> = {
  grid: LayoutGrid,
  inbox: Inbox,
  agents: Bot,
  shield: Shield,
  arrow: ArrowRight,
  wallet: Wallet,
  activity: Activity,
  upload: Upload,
  clock: Clock,
  file: FileText,
  search: Search,
  check: Check,
  flag: Flag,
  chat: MessageSquareText,
  bank: Landmark,
  chart: ChartColumn,
  trend: TrendingUp,
  card: CreditCard,
  bell: Bell,
  lock: Lock,
  phone: Smartphone,
  receipt: Receipt,
  users: Users,
  send: ArrowLeftRight,
  home: House,
}

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  const Cmp = icons[name]
  return <Cmp size={size} strokeWidth={2} className={`shrink-0 ${className}`} aria-hidden="true" />
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  housing: House, utilities: Zap, dining: Utensils, groceries: ShoppingCart, shopping: ShoppingBag, transport: Bus,
  travel: Plane, entertainment: Clapperboard, digital: Tv, health: HeartPulse, family: Users, transfer: ArrowLeftRight,
  gifts: Gift, wealth: PiggyBank, income: Wallet, internal: Repeat, other: CircleEllipsis,
}

/** A spending category's icon in its chart colour; `badge` sets it in a tinted circle, as at the start of a list row. */
export function CategoryIcon({ code, size = '1.05em', badge = false }: { code?: string | null; size?: number | string; badge?: boolean }) {
  const Cmp = CATEGORY_ICON[code ?? ''] ?? CircleEllipsis
  const color = categoryColor(code)
  const icon = <Cmp size={size} strokeWidth={2.25} className="shrink-0" style={{ color }} aria-hidden="true" />
  if (!badge) return icon
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }} aria-hidden="true">
      {icon}
    </span>
  )
}
