"use client";

// One shared rAF loop for every animated kit surface (KTD6, B5). Never start
// a loop per component. StrictMode double-mount subscribe/unsubscribe leaves
// a single armed loop.

type FrameListener = (frameTime: number) => void;

const listeners = new Set<FrameListener>();
let rafId: number | null = null;

function tick(frameTime: number) {
  for (const listener of listeners) listener(frameTime);
  if (listeners.size === 0) {
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function ensureLoop() {
  if (rafId !== null) return;
  if (typeof requestAnimationFrame !== "function") return;
  rafId = requestAnimationFrame(tick);
}

export function subscribeRaf(listener: FrameListener): () => void {
  listeners.add(listener);
  ensureLoop();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

export function rafListenerCount() {
  return listeners.size;
}

/** Test seam: deliver one frame without waiting on the browser clock. */
export function emitRafForTests(frameTime = 0) {
  for (const listener of listeners) listener(frameTime);
}
