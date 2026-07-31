"use client";

export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container" role="alert">
      <div className="form-grid">
        <h1 className="mono">MARKET VIEW UNAVAILABLE</h1>
        <p className="label mono status-negative">
          A client-side error interrupted this route. No transaction was submitted.
        </p>
        <button className="button mono" type="button" onClick={reset}>
          TRY AGAIN
        </button>
      </div>
    </main>
  );
}
