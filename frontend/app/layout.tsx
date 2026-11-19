import "./globals.css";
import type { Metadata, Viewport } from "next";
import AnimatedFavicon from "@/components/AnimatedFavicon";
import { AuthProvider } from "@/components/AuthProvider";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Alice in Borderland · The Last Room",
    template: "%s · The Last Room",
  },
  applicationName: "Alice in Borderland: The Last Room",
  description:
    "A four-player broadcast game of possible futures. Cross the 5×5 moving rooms, read the cards, predict the shift, and unseal the final door before The Dealer closes the arena.",
  keywords: [
    "Alice in Borderland",
    "The Last Room",
    "multiplayer game",
    "AI game director",
    "Three.js",
  ],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
  openGraph: {
    title: "Alice in Borderland · The Last Room",
    description:
      "Four players. Five by five moving rooms. One final door. The broadcast is live.",
    type: "website",
    siteName: "Alice in Borderland: The Last Room",
    images: [{
      url: "/opengraph.svg",
      width: 1200,
      height: 630,
      alt: "Alice in Borderland: The Last Room",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Alice in Borderland · The Last Room",
    description: "Four players. Five by five moving rooms. One final door.",
    images: ["/opengraph.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#040507",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-void text-bone antialiased">
        <AuthProvider>
          <AnimatedFavicon />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
