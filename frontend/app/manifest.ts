import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alice in Borderland: The Last Room",
    short_name: "The Last Room",
    description:
      "A four-player broadcast game of possible futures across a moving 5×5 arena.",
    start_url: "/",
    display: "standalone",
    background_color: "#040507",
    theme_color: "#040507",
    orientation: "landscape-primary",
    icons: [
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
