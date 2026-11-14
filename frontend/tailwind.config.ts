import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Shell palette: off-white paper, charcoal ink, door colours.
        paper: "#f4f1ea",
        chalk: "#fbfaf6",
        ink: "#14161a",
        coal: "#0b0c0e",
        concrete: "#1b1d22",
        panel: "#16181c",
        panel2: "#22252b",
        edge: "#33373f",
        bone: "#f4f1ea",
        dim: "#9a9a93",
        red: "#e23b3b",
        blue: "#3f7bd9",
        yellow: "#e8b53a",
        green: "#3f9f6b",
        alert: "#e23b3b",
        // Backwards-compatible aliases used by older screens.
        void: "#0b0c0e",
        amber: "#e8b53a",
        cyan: "#3f7bd9",
        violet: "#8b93a7",
        tri: "#e8b53a",
        cir: "#3f7bd9",
        sqr: "#8b93a7",
        danger: "#e23b3b",
        ok: "#3f9f6b",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 42px -10px rgba(232, 181, 58, 0.45)",
        cool: "0 0 42px -10px rgba(63, 123, 217, 0.4)",
        card: "0 24px 70px -28px rgba(0,0,0,0.35)",
        hud: "0 18px 60px -30px rgba(0,0,0,0.9)",
      },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(14px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        scan: { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(100%)" } },
      },
      animation: {
        rise: "rise 0.6s cubic-bezier(0.2,0.8,0.2,1) both",
        scan: "scan 4s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
