/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        body: ['"Inter var"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: '#0f172a',
        card: '#0b1220',
        accent: '#22d3ee',
      },
      boxShadow: {
        glow: '0 10px 40px rgba(34, 211, 238, 0.15)',
      },
    },
  },
  plugins: [],
}
