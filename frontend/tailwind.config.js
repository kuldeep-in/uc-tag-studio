/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#FF3621',
          dark: '#1B3139',
        },
      },
    },
  },
  plugins: [],
};
