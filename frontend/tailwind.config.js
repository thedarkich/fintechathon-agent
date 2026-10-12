/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        sheet: 'var(--sheet)',
        well: 'var(--well)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        ink3: 'var(--ink-3)',
        rule: 'var(--rule)',
        indigo: 'var(--indigo)',
        'indigo-wash': 'var(--indigo-wash)',
        jade: 'var(--jade)',
        'jade-wash': 'var(--jade-wash)',
        amber: 'var(--amber)',
        'amber-wash': 'var(--amber-wash)',
        vermilion: 'var(--vermilion)',
        'vermilion-wash': 'var(--vermilion-wash)',
      },
      fontFamily: {
        sans: ['Manrope', '"PingFang SC"', '"Hiragino Sans GB"', '"Noto Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
