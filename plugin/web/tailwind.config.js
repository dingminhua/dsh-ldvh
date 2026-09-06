/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        ldvh: {
          bg: 'rgb(var(--ldvh-bg) / <alpha-value>)',
          panel: 'rgb(var(--ldvh-panel) / <alpha-value>)',
          border: 'rgb(var(--ldvh-border) / <alpha-value>)',
          'text-primary': 'rgb(var(--ldvh-text-primary) / <alpha-value>)',
          'text-secondary': 'rgb(var(--ldvh-text-secondary) / <alpha-value>)',
          accent: 'rgb(var(--ldvh-accent) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
