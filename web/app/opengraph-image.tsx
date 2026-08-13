import { ImageResponse } from "next/og";

// R32/L-4: page metadata promised a social preview and no 1200x630 asset
// existed anywhere in the repo — only square brand marks — so unfurls fell back
// to whatever the crawler guessed. Generating it here rather than checking in a
// PNG keeps it in step with the wordmark and description automatically, and
// needs no design asset to be supplied before the requirement can close.
//
// Rendered once at build time: `output: "export"` has no request-time runtime,
// so this emits a static file alongside the rest of the export.

// Required under `output: "export"` — the route is otherwise treated as
// dynamic and the build refuses to statically collect it.
export const dynamic = "force-static";

export const alt = "OVRFLO Markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px",
          background: "#FDFDFC",
          color: "#0A0A0A",
          fontFamily: "monospace",
        }}
      >
        <div style={{ fontSize: 96, letterSpacing: "-0.03em" }}>OVRFLO</div>
        <div style={{ fontSize: 40, color: "#6B6B6B", marginTop: 24 }}>
          Self-repaying loans against Pendle PT yield
        </div>
        <div style={{ display: "flex", marginTop: 64, height: 4, background: "#E8930C", width: 240 }} />
      </div>
    ),
    size,
  );
}
