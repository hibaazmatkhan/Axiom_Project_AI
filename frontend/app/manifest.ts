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
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
