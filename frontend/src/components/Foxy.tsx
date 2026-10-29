import foxy96 from '../assets/foxy-96.png'
import foxy192 from '../assets/foxy-192.png'
import { useLang } from '../i18n'

/** The assistant's name, 小狐 in Chinese and Foxy in English. */
export const FOXY = { zh: '小狐', en: 'Foxy' }

/** 小狐 / Foxy's face: the fox on a white disc, wherever the assistant speaks. */
export function Foxy({ size = 28 }: { size?: number }) {
  const { tr } = useLang()
  return (
    <img src={size > 48 ? foxy192 : foxy96} srcSet={`${foxy192} 2x`} width={size} height={size} alt={tr(FOXY.en, FOXY.zh)}
      className="shrink-0 rounded-full shadow-[0_0_0_1px_var(--rule)]" />
  )
}
