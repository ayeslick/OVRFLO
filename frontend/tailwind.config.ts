import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Deep navy/black base
        ovfl: {
          900: '#0a0e17',
          800: '#0f1520',
          700: '#151d2d',
          600: '#1c2640',
          500: '#243050',
        },
        // Primary: Gold (premium, value, abundance)
        gold: {
          DEFAULT: '#FFB800',
          light: '#FFC933',
          dark: '#E6A600',
        },
        // Secondary: Amber (energy, warmth)
        amber: {
          DEFAULT: '#FFA000',
          light: '#FFB133',
          dark: '#E68F00',
        },
        // Depth: Teal (flow, trust, liquidity)
        teal: {
          DEFAULT: '#006064',
          light: '#00838F',
          dark: '#004D4F',
        },
        // Accent: Purple (innovation, transformation)
        purple: {
          DEFAULT: '#6A1B9A',
          light: '#8E24AA',
          dark: '#4A148C',
        },
        // Highlight: Orange (urgency, energy)
        orange: {
          DEFAULT: '#FF6B35',
          light: '#FF8555',
          dark: '#E65525',
        },
        // Success: Seafoam (completion, positive)
        seafoam: {
          DEFAULT: '#4DB6AC',
          light: '#80CBC4',
          dark: '#26A69A',
        },
        // Legacy accent (maps to gold now)
        accent: {
          DEFAULT: '#FFB800',
          dark: '#E6A600',
          light: '#FFC933',
          glow: 'rgba(255, 184, 0, 0.15)',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255,184,0,0.03) 0%, rgba(0,96,100,0.02) 100%)',
        'gold-gradient': 'linear-gradient(135deg, #FFB800 0%, #FFA000 100%)',
        'teal-gradient': 'linear-gradient(180deg, #006064 0%, #00838F 100%)',
        'shimmer': 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(255, 184, 0, 0.3)',
        'glow-sm': '0 0 10px rgba(255, 184, 0, 0.2)',
        'glow-intense': '0 6px 20px rgba(255, 184, 0, 0.5)',
        'glow-teal': '0 0 20px rgba(0, 96, 100, 0.3)',
        'glow-purple': '0 0 20px rgba(106, 27, 154, 0.3)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.3)',
      },
      backdropBlur: {
        'glass': '12px',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'liquid-wave': 'liquid-wave 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255, 184, 0, 0.3)' },
          '50%': { boxShadow: '0 0 30px rgba(255, 184, 0, 0.6)' },
        },
        'liquid-wave': {
          '0%, 100%': { borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%' },
          '50%': { borderRadius: '30% 60% 70% 40% / 50% 60% 30% 60%' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config

