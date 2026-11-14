import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "AXIOM · THE LAST ROOM — a game of possible futures",
  description:
    "A 5×5 matrix of moving white rooms. Four coloured doors, d10 pedestals and possible futures. Cross with your team, predict the shift, and unseal the final door at A5.",
};

export const viewport: Viewport = {
  themeColor: "#f4f1ea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink">{children}</body>
    </html>
  );
}
