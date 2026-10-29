import { useSearchParams } from 'react-router-dom'
import { PageHead } from '../components/bits'
import { PlacesCard } from '../components/Places'
import { useLang } from '../i18n'

/** Real places for a search the WeChat assistant started ('/places?q=火锅&party=4'): the same card as in the app's chat. */
export default function Places() {
  const { tr } = useLang()
  const [params] = useSearchParams()
  const what = params.get('q')?.slice(0, 30) || tr('restaurant', '餐厅')
  const party = Number(params.get('party')) || null
  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Places nearby', '附近的地方')} />
      <div className="mx-auto max-w-3xl">
        <PlacesCard what={what} near={params.get('near')?.slice(0, 40) || null} party={party && party <= 20 ? party : null}
          date={params.get('date')} time={params.get('time')} />
      </div>
    </main>
  )
}
