"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="grid-bg">
        <main className="container" role="alert">
          <div className="form-grid">
            <h1 className="mono">OVRFLO UNAVAILABLE</h1>
            <p className="label mono status-negative">
              The application could not recover this view. No transaction was submitted.
            </p>
            <button className="button mono" type="button" onClick={reset}>
              RELOAD APPLICATION
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
