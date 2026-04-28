import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        rootmap: {
          50: "#f7f6f2",
          100: "#efebdf",
          200: "#ded4be",
          300: "#cdbd9d",
          500: "#8e7857",
          700: "#5e4e38",
          900: "#2e261b"
        }
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans SC", "ui-sans-serif", "system-ui"]
      },
      boxShadow: {
        card: "0 12px 35px -18px rgba(51, 46, 40, 0.35)"
      }
    },
  },
  plugins: [],
};

export default config;
