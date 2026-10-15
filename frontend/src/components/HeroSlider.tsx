import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useLang } from '../i18n'

export type Slide = { key: string; title: ReactNode; lead: string; visual: ReactNode }

/**
 * The landing page's big green banner: one slide at a time, moved with the round arrows, the dots,
 * a swipe or the arrow keys. It never moves by itself.
 */
export function HeroSlider({ slides, actions }: { slides: Slide[]; actions: ReactNode }) {
  const { tr } = useLang()
  const [index, setIndex] = useState(0)
  const items = useRef<(HTMLDivElement | null)[]>([])
  const touch = useRef<number | null>(null)
  const count = slides.length
  const go = (next: number) => setIndex((next + count) % count)

  // the slides out of view can't be reached with Tab or by a screen reader
  useEffect(() => {
    items.current.forEach((el, i) => el?.toggleAttribute('inert', i !== index))
  }, [index])

  return (
    <section className="lp-hero" aria-roledescription={tr('carousel', '轮播')} aria-label={tr('What the bank does', '银行能做什么')}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(index - 1); if (e.key === 'ArrowRight') go(index + 1) }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touch.current === null) return
        const dx = e.changedTouches[0].clientX - touch.current
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1))
        touch.current = null
      }}>
      <div className="lp-hero-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {slides.map((slide, i) => (
          <div key={slide.key} ref={(el) => { items.current[i] = el }} className="lp-slide" role="group"
            aria-roledescription={tr('slide', '幻灯片')} aria-label={`${i + 1} / ${count}`}>
            <div className="lp-slide-copy">
              {i === 0 ? <h1>{slide.title}</h1> : <h2>{slide.title}</h2>}
              <p>{slide.lead}</p>
              <div className="lp-actions">{actions}</div>
            </div>
            <div className="lp-slide-visual">{slide.visual}</div>
          </div>
        ))}
      </div>
      <div className="lp-hero-controls">
        <button type="button" className="lp-arrow" onClick={() => go(index - 1)} aria-label={tr('Previous', '上一张')}><ArrowLeft size={20} /></button>
        <div className="lp-dots">
          {slides.map((slide, i) => (
            <button key={slide.key} type="button" onClick={() => go(i)} aria-label={tr(`Slide ${i + 1}`, `第 ${i + 1} 张`)} aria-current={i === index} className={i === index ? 'is-active' : ''} />
          ))}
        </div>
        <button type="button" className="lp-arrow" onClick={() => go(index + 1)} aria-label={tr('Next', '下一张')}><ArrowRight size={20} /></button>
      </div>
    </section>
  )
}
