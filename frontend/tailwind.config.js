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
      // one face everywhere, the system one (San Francisco on Apple devices); `font-mono` is kept as a name
      // for figures but set in the same face with aligned digits, so nothing on screen is monospace
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Helvetica Neue"', '"Segoe UI Variable Text"', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Helvetica Neue"', '"Segoe UI Variable Text"', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
      },
      borderRadius: { box: '12px', panel: '18px' },
    },
  },
  plugins: [],
}
