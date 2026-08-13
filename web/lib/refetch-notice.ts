type Listener = () => void;

const listeners = new Set<Listener>();
let failed = false;

function notify() {
  for (const listener of listeners) listener();
}

export function getRefetchNotice(): boolean {
  return failed;
}

export function subscribeRefetchNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBackgroundRefetchFailed(next: boolean) {
  if (failed === next) return;
  failed = next;
  notify();
}

export function isBackgroundRefetchFailure(query: {
  state: { status: string; dataUpdatedAt: number; fetchStatus: string };
}): boolean {
  return query.state.status === "error" && query.state.dataUpdatedAt > 0 && query.state.fetchStatus === "idle";
}
