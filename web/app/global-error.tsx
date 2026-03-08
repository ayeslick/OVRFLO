"use client";

import { getErrorMessage, isFrontendConfigError } from "@/lib/errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const configError = isFrontendConfigError(error);
  const message = getErrorMessage(error, "The application encountered an unrecoverable error.");

  return (
    <html lang="en">
      <body
        style={{
          backgroundColor: "#0b1221",
          color: "#a3c0e8",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h2 style={{ color: "#ffffff", fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            {configError ? "Frontend configuration error" : "Critical error"}
          </h2>
          <p style={{ color: "#5a7da8", marginBottom: "1.5rem" }}>
            {configError ? message : "The application encountered an unrecoverable error."}
          </p>
          {configError ? (
            <p style={{ color: "#5a7da8", marginBottom: "1.5rem", maxWidth: "32rem" }}>
              Review web/.env.example and ensure the deployed mainnet factory
              address, chain ID, and Reown project ID are configured.
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              backgroundColor: "#5dc0f5",
              color: "#0b1221",
              border: "none",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
