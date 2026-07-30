export default function Loading() {
  return (
    <main className="container" role="status" aria-live="polite">
      <div className="form-grid">
        <h1 className="mono">LOADING MARKETS</h1>
        <p className="label mono">Preparing the verified mainnet view.</p>
      </div>
    </main>
  );
}
