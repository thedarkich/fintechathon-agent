import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'

/** The customer's balances, cards, locks and reminder count, shared by every workspace page. */
export function useOverview() {
  const { lang } = useLang()
  return useQuery({ queryKey: ['overview', lang], queryFn: () => api.overview(lang), refetchInterval: 20_000 })
}

export function usePlans() {
  const { lang } = useLang()
  return useQuery({ queryKey: ['plans', lang], queryFn: () => api.plans(lang), refetchInterval: (q) => (q.state.data?.items.some((p) => p.status === 'scheduled') ? 10_000 : 30_000) })
}
