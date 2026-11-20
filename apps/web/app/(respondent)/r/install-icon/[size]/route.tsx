import { ImageResponse } from "next/og";

export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: requested } = await params;
  if (requested !== "192" && requested !== "512") {
    return new Response(null, { status: 404 });
  }

  const size = Number(requested);
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#F3F2F7", display: "flex", height: "100%", justifyContent: "center", width: "100%" }}>
      <div style={{ background: "#FF4F8B", border: "2px solid #C21E5B", borderRadius: "50%", display: "flex", height: size / 2, width: size / 2 }} />
    </div>,
    { width: size, height: size },
  );
}
