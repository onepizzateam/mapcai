import type { Config } from 'tailwindcss';

// Design tokens are the single source of truth in globals.css (CSS custom
// properties, agents.md §7). Tailwind references them via var() so the theme
// stays swappable from one file.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'health-low': 'var(--color-health-low)',
        'health-mid': 'var(--color-health-mid)',
        'health-high': 'var(--color-health-high)',
        driving: 'var(--color-driving)',
        charging: 'var(--color-charging)',
        parked: 'var(--color-parked)',
        'soc-critical': 'var(--color-soc-critical)',
        'soc-low': 'var(--color-soc-low)',
        'soc-ok': 'var(--color-soc-ok)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'ui-monospace', 'monospace'],
      },
      // 4px base grid, agents.md §7 — no arbitrary values.
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
      },
    },
  },
  plugins: [],
};

export default config;
