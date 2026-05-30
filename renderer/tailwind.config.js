/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0d0d14',
        'bg-secondary': '#13131e',
        'bg-card': '#1a1a2e',
        'bg-hover': '#1f1f35',
        'border-default': '#2a2a45',
        'border-light': '#333355',
        'accent-1': '#7c3aed',
        'accent-2': '#3b82f6',
        'text-primary': '#e8e8f0',
        'text-secondary': '#9898b8',
        'text-muted': '#606078',
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '24px',
      },
      animation: {
        'cursor-blink': 'blink 1s step-end infinite',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        slideUp: {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
