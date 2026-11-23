import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Broadcast shell: near-black rooms, paper-white type, signal colours.
        void: "#040507",
        coal: "#08090c",
        concrete: "#101217",
        panel: "#111318",
        panel2: "#181b22",
        edge: "#2b303a",
        bone: "#f4f1ea",
        dim: "#9ba1ad",
        ash: "#69707d",
        red: "#ff4655",
        blood: "#d7263d",
        blue: "#5aa7ff",
        neon: "#68e8ff",
        yellow: "#f4c542",
        gold: "#e8b53a",
        green: "#58d68d",
        jade: "#3f9f6b",
        paper: "#f4f1ea",
        chalk: "#fbfaf6",
        ink: "#14161a",
        danger: "#ff4655",
        ok: "#58d68d",
        // Backwards-compatible aliases used by older game screens.
        amber: "#f4c542",
        cyan: "#68e8ff",
        violet: "#8b93a7",
        tri: "#f4c542",
        cir: "#5aa7ff",
        sqr: "#8b93a7",
        alert: "#ff4655",
      },
      fontFamily: {
        sans: ["Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Arial Narrow", "Roboto Condensed", "Impact", "Haettenschweiler", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 42px -10px rgba(244,197,66,0.45)",
        cool: "0 0 42px -10px rgba(90,167,255,0.4)",
        danger: "0 0 42px -12px rgba(255,70,85,0.55)",
        card: "0 28px 80px -36px rgba(0,0,0,0.9)",
        hud: "0 18px 60px -30px rgba(0,0,0,0.95)",
        signal: "0 0 0 1px rgba(244,197,66,0.18), 0 0 42px -18px rgba(244,197,66,0.55)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-110%)" },
          "100%": { transform: "translateY(110%)" },
        },
        flicker: {
          "0%, 100%": { opacity: "0.9" },
          "7%": { opacity: "0.55" },
          "9%": { opacity: "1" },
          "38%": { opacity: "0.75" },
          "42%": { opacity: "1" },
          "72%": { opacity: "0.62" },
          "74%": { opacity: "0.95" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.9" },
          "70%": { transform: "scale(1.18)", opacity: "0" },
          "100%": { transform: "scale(1.18)", opacity: "0" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,-14px,0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(10px) scale(0.98)" },
          "12%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "82%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(-6px) scale(0.99)" },
        },
      },
      animation: {
        rise: "rise 0.65s cubic-bezier(0.2,0.8,0.2,1) both",
        scan: "scan 4.5s linear infinite",
        flicker: "flicker 7s linear infinite",
        ticker: "ticker 32s linear infinite",
        "pulse-ring": "pulse-ring 2.4s ease-out infinite",
        float: "float-slow 8s ease-in-out infinite",
        shimmer: "shimmer 3.4s linear infinite",
        "toast-in": "toast-in 5s cubic-bezier(0.2,0.8,0.2,1) both",
        "toast-sealed": "toast-in 2s cubic-bezier(0.2,0.8,0.2,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
