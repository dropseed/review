/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        xxs: ["0.6875rem", { lineHeight: "1.5" }], // 11px (was 10px)
        "2xs": ["0.75rem", { lineHeight: "1.5" }], // 12px (was 11px)
      },
      colors: {
        // Extended backgrounds
        bg: {
          primary: "#0c0a09",
          secondary: "#1c1917",
          tertiary: "#292524",
          elevated: "#44403c",
        },
        // Brand colors from logo
        terracotta: {
          400: "#c75d4a",
          500: "#a63d2f",
          600: "#8b3426",
        },
        sage: {
          400: "#6b9b7a",
          500: "#4a7c59",
          600: "#3d6549",
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out forwards",
        "slide-in": "slide-in 0.2s ease-out forwards",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(0.267rem)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-0.533rem)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
