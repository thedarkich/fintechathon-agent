import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  ChartColumn,
  Check,
  Clock,
  CreditCard,
  FileText,
  Flag,
  Inbox,
  Landmark,
  LayoutGrid,
  Lock,
  MessageSquareText,
  Receipt,
  Search,
  Shield,
  Smartphone,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type IconName =
  | 'grid' | 'inbox' | 'agents' | 'shield' | 'arrow' | 'wallet' | 'activity' | 'upload' | 'clock' | 'file' | 'search' | 'check' | 'flag'
  | 'chat' | 'bank' | 'chart' | 'trend' | 'card' | 'bell' | 'lock' | 'phone' | 'receipt' | 'users'

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
}

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  const Cmp = icons[name]
  return <Cmp size={size} strokeWidth={2} className={`shrink-0 ${className}`} aria-hidden="true" />
}
