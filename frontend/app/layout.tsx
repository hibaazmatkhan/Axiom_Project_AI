import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "AXIOM — AI-Driven Multiplayer Dynamic Labyrinth",
  description:
    "Four players, one labyrinth that rearranges itself by hidden rules. Observe, predict, adapt — while NEXUS learns your team.",
};

export const viewport: Viewport = {
  themeColor: "#05060f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
