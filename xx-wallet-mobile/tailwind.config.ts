import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Official xx network brand palette (May 2026 brand pass).
        // Primary teal #08cdd7 sourced from the xx network style guide.
        // The full xx-* scale is derived around it (eyeballed HSL ramp at
        // hue ~184, saturation high, lightness stepped) so existing usages
        // like bg-xx-500/10 and theme('colors.xx.800/0.4') keep working.
        xx: {
          50: '#e5fafb', // brand pale teal (exact)
          100: '#c5f0f4',
          200: '#97e7ee',
          300: '#5fdde6',
          400: '#1ed3dd',
          500: '#08cdd7', // brand primary
          600: '#07a4ae',
          700: '#057780',
          800: '#035155',
          900: '#023538',
        },
        // Brand sister accents from the style guide. Used sparingly — currently
        // earmarked for future Phase 2a multisig states (lavender for pending,
        // cyan for info badges) and any future "this is special" moments.
        'xx-cyan': '#00c4ff',
        'xx-lavender': '#6f74ff',
        // Neutral dark surfaces. Kept as-is — the wallet is dark-only on
        // purpose, and the brand's own #3d3d3d/#7a7a7a are for body text on
        // light surfaces (different role) so we don't reuse them here.
        ink: {
          950: '#050505',
          900: '#0a0a0a',
          800: '#111111',
          700: '#1a1a1a',
          600: '#262626',
          500: '#3d3d3d',
          400: '#666666',
          300: '#999999',
          200: '#cccccc',
          100: '#e5e5e5',
          50: '#f5f5f5',
        },
        // Semantic
        success: '#08cdd7', // matches new brand primary
        warning: '#ffb547',
        danger: '#ff5c5c',
      },
      fontFamily: {
        // Official xx network typography from the style guide:
        //   Display/headings → Roboto
        //   Body              → Helvetica Neue
        //   (Brand guide doesn't specify a mono — we keep JetBrains Mono
        //    because addresses/balances/hashes need a real mono font.)
        // Helvetica Neue isn't a free webfont; the fallback chain renders it
        // natively on Apple devices and degrades gracefully on Win/Linux.
        display: ['Roboto', 'system-ui', 'sans-serif'],
        sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Mobile-optimized type scale
        'balance-xl': ['2.5rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '600' }],
        'balance': ['2rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
      animation: {
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fade-in 0.2s ease-out',
      },
      keyframes: {
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
