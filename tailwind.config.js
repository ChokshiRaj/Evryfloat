/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        evry: {
          bg: "#090909",
          surface: "#171717",
          surfaceHover: "#1f1f1f",
          accent: "#F47735",
          accentHover: "#ff884d",
          text: "#FFFFFF",
          muted: "#A1A1AA",
          border: "#292929",
          borderLight: "#383838",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        notch: "0 10px 30px -5px rgba(0, 0, 0, 0.7), 0 0 1px 1px rgba(255, 255, 255, 0.05)",
        expanded: "0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.08)",
        glow: "0 0 20px -3px rgba(244, 119, 53, 0.35)",
      },
      keyframes: {
        slideDown: {
          "0%": { opacity: 0, transform: "translateY(-6px) scale(0.98)" },
          "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        slideDown: "slideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },
    },
  },
  plugins: [],
};

