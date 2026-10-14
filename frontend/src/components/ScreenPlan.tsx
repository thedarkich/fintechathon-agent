import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api/client'
import type { ScreenAction } from '../api/types'
import { useLang } from '../i18n'
import { ConfirmCard, usePlan } from './PlanView'

/**
 * A request made with a screen's own buttons. It becomes the same kind of plan as a chat request: the bank's
 * rules give it a level, and it waits on the same confirm card (PIN and code when the rules say so).
 */
export function useScreenPlan() {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [planId, setPlanId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start(action: ScreenAction, args: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const { plan } = await api.screenPlan(action, args, lang)
      qc.setQueryData(['plan', plan.id, lang], plan)
      setPlanId(plan.id)
    } catch (err) {
      setError(errorText(err, lang))
    } finally {
      setBusy(false)
    }
  }
  return { planId, busy, error, start, reset: () => { setPlanId(null); setError('') } }
}

const FINISHED = ['done', 'failed', 'cancelled', 'rolled_back', 'scheduled']

/** The confirm card for a screen's request, and once it is settled, a way back to the form. */
export function ScreenConfirm({ planId, again, onAgain }: { planId: string; again: string; onAgain: () => void }) {
  const { tr, lang } = useLang()
  const plan = usePlan(planId)
  const status = plan.data?.status
  // going back to the form withdraws the request waiting here, so nothing is left half-confirmed
  const change = async () => {
    try { await api.cancel(planId, false, lang) } catch { /* already settled */ }
    onAgain()
  }
  return (
    <div className="space-y-3">
      <ConfirmCard planId={planId} />
      {status && FINISHED.includes(status) && (
        <button type="button" className="btn btn-line w-full py-2.5" onClick={onAgain}>{status === 'done' ? again : tr('Back', '返回修改')}</button>
      )}
      {status === 'awaiting_approval' && (
        <button type="button" className="w-full text-center text-sm font-semibold text-ink2 hover:text-ink" onClick={() => void change()}>{tr('Change the details', '修改信息')}</button>
      )}
    </div>
  )
}
