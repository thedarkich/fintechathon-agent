/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
      // one face everywhere, Manrope (bundled from npm), with the system's Chinese face for Chinese; `font-mono`
      // is kept as a name for figures but set in the same face with aligned digits, so nothing on screen is monospace
      fontFamily: {
        sans: ['"Manrope Variable"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"Manrope Variable"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: { box: '14px', panel: '22px' },
    },
  },
  plugins: [],
}
