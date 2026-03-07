import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1221",
          color: "#5dc0f5",
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        O
      </div>
    ),
    size
  );
}
