import { brandName } from "@envoi-labs/ui";

export function GET() {
  return Response.json({
    name: brandName,
    short_name: brandName,
    start_url: "/r",
    scope: "/r",
    display: "standalone",
    background_color: "#F3F2F7",
    theme_color: "#F3F2F7",
    icons: [192, 512].map((size) => ({
      src: `/r/install-icon/${size}`, sizes: `${size}x${size}`, type: "image/png",
    })),
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
