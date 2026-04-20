import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        rule: "var(--rule)",
        accent: "var(--accent)",
        "state-confident": "var(--state-confident)",
        "state-domestic": "var(--state-domestic)",
        "state-unknown": "var(--state-unknown)",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif",
        ],
        "serif-kr": ['"Noto Serif KR"', "serif"],
        display: ["Fraunces", '"Noto Serif KR"', "serif"],
        mono: ['"Geist Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "1.3" }],
        xs: ["11px", { lineHeight: "1.4" }],
        sm: ["13px", { lineHeight: "1.5" }],
        base: ["15px", { lineHeight: "1.55" }],
        lg: ["18px", { lineHeight: "1.5" }],
        xl: ["22px", { lineHeight: "1.3" }],
        "2xl": ["28px", { lineHeight: "1.2" }],
        "3xl": ["36px", { lineHeight: "1.15" }],
        "4xl": ["56px", { lineHeight: "1.05" }],
        display: ["72px", { lineHeight: "1" }],
      },
      letterSpacing: {
        caps: "0.16em",
        "caps-tight": "0.1em",
        "caps-wide": "0.2em",
        tight: "-0.01em",
        tighter: "-0.02em",
        tightest: "-0.03em",
      },
      maxWidth: {
        content: "720px",
      },
    },
  },
  plugins: [],
} satisfies Config;
