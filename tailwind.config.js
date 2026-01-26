/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontSize: {
        xxs: ["0.625rem", { lineHeight: "1.4" }], // ~10px at default
        "2xs": ["0.6875rem", { lineHeight: "1.4" }], // ~11px at default
      },
      colors: {
        // Extended backgrounds
        bg: {
          primary: "#0c0a09",
          secondary: "#1c1917",
          tertiary: "#292524",
          elevated: "#44403c",
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
