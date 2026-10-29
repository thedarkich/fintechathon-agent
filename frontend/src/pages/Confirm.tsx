import { Link, useParams } from 'react-router-dom'
import { useLang } from '../i18n'
import { Notice, PageHead } from '../components/bits'
import { ConfirmCard } from '../components/PlanView'
import { Booked } from '../components/Places'

/** Where a link from the WeChat assistant lands: the request's confirm card, in the bank app, for the signed-in customer only. */
export default function Confirm() {
  const { tr } = useLang()
  const { planId = '' } = useParams()
  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Confirm in the app', '在 App 里确认')} />
      <div className="mx-auto max-w-xl space-y-4">
        <Notice icon="lock" title={tr('This request came from the WeChat assistant', '这笔请求来自微信助手')}>
          {tr('Check every detail. Nothing happens until you confirm it here.', '请核对每一项。只有你在这里确认后才会执行。')}
        </Notice>
        <ConfirmCard planId={planId} showRequest />
        <Booked planId={planId} />
        <Link to="/wechat" className="block text-center text-sm font-semibold text-[var(--action)]">{tr('← Back to the WeChat assistant', '← 回到微信助手')}</Link>
      </div>
    </main>
  )
}
