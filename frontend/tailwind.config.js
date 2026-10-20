/** @type {import('tailwindcss').Config} */
const sans = ['Manrope', '"PingFang SC"', '"Noto Sans SC"', '"Microsoft YaHei"', 'sans-serif']

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        card: 'var(--card)',
        paper: 'var(--paper)',
        paper2: 'var(--paper-2)',
        field: 'var(--field)',
        sheet: 'var(--sheet)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        rule: 'var(--rule)',
        rule2: 'var(--rule-strong)',
        cinnabar: 'var(--cinnabar)',
        jade: 'var(--jade)',
        cta: 'var(--cta)',
        'cta-ink': 'var(--cta-ink)',
      },
      // one family everywhere; figures line up through tabular numbers, not a monospace face
      fontFamily: {
        sans,
        mono: sans,
        code: ['"Geist Mono Variable"', 'ui-monospace', 'SF Mono', 'monospace'],
      },
      // the type scale: xs 12 · cap 13 · sm 14 · body 15 · lg 18 (section) · page titles 30
      fontSize: {
        cap: ['0.8125rem', { lineHeight: '1.45' }],
        body: ['0.9375rem', { lineHeight: '1.55' }],
      },
      // the radius scale: box 12 (controls, insets) · tile 16 (inner panels) · panel 20 (cards)
      borderRadius: { box: '12px', tile: '16px', panel: '20px' },
    },
  },
  plugins: [],
}
