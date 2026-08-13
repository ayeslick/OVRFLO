"use client";

// Live prefers-reduced-motion and devicePixelRatio stores. Canvas decorative
// motion unsubscribes on reduce; numeric text keeps updating (P4, B6).

type BoolListener = (value: boolean) => void;
type NumberListener = (value: number) => void;

let reducedMotion = false;
let reducedMotionBound = false;
let reducedMotionFromTest = false;
const reducedListeners = new Set<BoolListener>();

let devicePixelRatioValue =
  typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
let dprFromTest = false;
let dprMedia: MediaQueryList | null = null;
const dprListeners = new Set<NumberListener>();

function emitReduced() {
  for (const listener of reducedListeners) listener(reducedMotion);
}

function readReducedFromWindow() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function bindReducedMotion() {
  if (reducedMotionBound || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  reducedMotionBound = true;
  if (!reducedMotionFromTest) readReducedFromWindow();
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onChange = () => {
    if (reducedMotionFromTest) return;
    reducedMotion = media.matches;
    emitReduced();
  };
  media.addEventListener("change", onChange);
}

function emitDpr() {
  for (const listener of dprListeners) listener(devicePixelRatioValue);
}

function bindDprMedia() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  if (dprMedia) dprMedia.removeEventListener("change", onDprMediaChange);
  if (!dprFromTest) devicePixelRatioValue = window.devicePixelRatio || 1;
  dprMedia = window.matchMedia(`(resolution: ${devicePixelRatioValue}dppx)`);
  dprMedia.addEventListener("change", onDprMediaChange);
}

function onDprMediaChange() {
  bindDprMedia();
  emitDpr();
}

export function getReducedMotion() {
  bindReducedMotion();
  return reducedMotion;
}

export function subscribeReducedMotion(listener: BoolListener): () => void {
  bindReducedMotion();
  reducedListeners.add(listener);
  listener(reducedMotion);
  return () => {
    reducedListeners.delete(listener);
  };
}

export function getDevicePixelRatio() {
  return devicePixelRatioValue;
}

export function subscribeDevicePixelRatio(listener: NumberListener): () => void {
  bindDprMedia();
  dprListeners.add(listener);
  listener(devicePixelRatioValue);
  return () => {
    dprListeners.delete(listener);
  };
}

export function setReducedMotionForTests(value: boolean) {
  reducedMotionFromTest = true;
  reducedMotion = value;
  emitReduced();
}

export function setDevicePixelRatioForTests(value: number) {
  dprFromTest = true;
  devicePixelRatioValue = value;
  emitDpr();
}
