import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#05060f",
        panel: "#0d1126",
        panel2: "#131834",
        edge: "#2a3358",
        bone: "#eef1ff",
        dim: "#8b93b5",
        tri: "#ff8a3d",
        cir: "#3dd6ff",
        sqr: "#b86bff",
        danger: "#ff5470",
        ok: "#5bffb0",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(61, 214, 255, 0.45)",
        card: "0 20px 60px -20px rgba(0,0,0,0.7)",
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
