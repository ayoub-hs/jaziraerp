/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        }
      },
      fontSize: {
        'pos-total': ['1.875rem', { lineHeight: '2.25rem', fontWeight: '900' }],
        'pos-change': ['1.5rem', { lineHeight: '2rem', fontWeight: '900' }],
        'pos-input': ['1.375rem', { lineHeight: '1.75rem', fontWeight: '700' }],
        'pos-qty': ['1.125rem', { lineHeight: '1.5rem', fontWeight: '700' }],
        'pos-name': ['1rem', { lineHeight: '1.375rem', fontWeight: '700' }],
        'pos-price': ['1rem', { lineHeight: '1.375rem', fontWeight: '700' }],
        'pos-body': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }],
        'pos-caption': ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '600' }],
        'pos-badge': ['0.75rem', { lineHeight: '1rem', fontWeight: '700' }],
      }
    },
  },
  plugins: [],
}
