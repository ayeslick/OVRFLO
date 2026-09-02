export type DisclosureLevel = "default" | "advanced";

type Listener = () => void;

const listeners = new Set<Listener>();
let level: DisclosureLevel = "default";

function notify() {
  for (const listener of listeners) listener();
}

export function getDisclosure(): DisclosureLevel {
  return level;
}

export function subscribeDisclosure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDisclosure(next: DisclosureLevel) {
  if (level === next) return;
  level = next;
  notify();
}

export function toggleDisclosure() {
  setDisclosure(level === "advanced" ? "default" : "advanced");
}

export function resetDisclosure() {
  setDisclosure("default");
}