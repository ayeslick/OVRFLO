import { ImageResponse } from "next/og";

export const alt = "OVRFLO";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 64,
          background: "linear-gradient(135deg, #0b1221, #0f1829)",
          color: "#ffffff",
        }}
      >
        <div style={{ fontSize: 80, fontWeight: 700 }}>OVRFLO</div>
        <div style={{ marginTop: 20, fontSize: 34, color: "#a3c0e8" }}>
          Pendle PT stream management
        </div>
      </div>
    ),
    size
  );
}
