import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        tft: {
          bg: "#0a0e1a",
          surface: "#111827",
          border: "#1f2a40",
          accent: "#c89b3c",
          gold: "#f0b429",
          text: "#e2e8f0",
          muted: "#64748b",
          hover: "#1e2d4a",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
