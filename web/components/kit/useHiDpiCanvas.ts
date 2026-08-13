"use client";

import { useEffect, useRef } from "react";
import { subscribeRaf } from "./rafDriver";
import { getDevicePixelRatio, getReducedMotion, subscribeDevicePixelRatio, subscribeReducedMotion } from "./motion";

export function useHiDpiCanvas(args: {
  cssWidth: number;
  cssHeight: number;
  animate: boolean;
  draw: (ctx: CanvasRenderingContext2D, cssWidth: number, cssHeight: number, nowMs: number) => void;
}) {
  const { cssWidth, cssHeight, animate, draw } = args;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    if (!canvasRef.current || cssWidth <= 0 || cssHeight <= 0) return;

    let ctx: CanvasRenderingContext2D | null = null;
    let unsubRaf: (() => void) | undefined;

    function sizeContext() {
      const node = canvasRef.current;
      if (!node) return null;
      const dpr = getDevicePixelRatio();
      node.width = Math.max(1, Math.floor(cssWidth * dpr));
      node.height = Math.max(1, Math.floor(cssHeight * dpr));
      node.style.width = `${cssWidth}px`;
      node.style.height = `${cssHeight}px`;
      const nextCtx = node.getContext("2d");
      if (!nextCtx) return null;
      nextCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return nextCtx;
    }

    ctx = sizeContext();

    function paint(nowMs: number) {
      if (!ctx) ctx = sizeContext();
      if (!ctx) return;
      drawRef.current(ctx, cssWidth, cssHeight, nowMs);
    }

    function syncLoop() {
      const node = canvasRef.current;
      if (!node) return;
      const live = animate && !getReducedMotion();
      node.dataset.motion = live ? "live" : "static";
      if (live && !unsubRaf) {
        unsubRaf = subscribeRaf(() => {
          paint(Date.now());
        });
      }
      if (!live && unsubRaf) {
        unsubRaf();
        unsubRaf = undefined;
      }
    }

    paint(Date.now());
    syncLoop();

    const unsubDpr = subscribeDevicePixelRatio(() => {
      ctx = sizeContext();
      paint(Date.now());
    });
    const unsubMotion = subscribeReducedMotion(() => {
      syncLoop();
      paint(Date.now());
    });

    return () => {
      unsubDpr();
      unsubMotion();
      unsubRaf?.();
    };
  }, [animate, cssHeight, cssWidth]);

  return canvasRef;
}
