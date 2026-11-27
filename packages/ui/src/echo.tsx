"use client";

import { useEffect, useRef } from "react";
import type { EchoRenderer } from "./echo-webgl";

export type EchoState = "idle" | "listen" | "think" | "sent" | "payout";

export interface EchoProps {
  state: EchoState;
  size: number;
  level?: () => number;
  "aria-hidden"?: boolean;
}

const stateLabels: Record<EchoState, string> = {
  idle: "Echo",
  listen: "Recording",
  think: "Preparing a follow-up",
  sent: "Answer saved",
  payout: "Payout",
};

export function Echo({ state, size, level, "aria-hidden": hidden = true }: EchoProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<EchoRenderer | null>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let disposed = false;
    let loading = false;
    let idle: number | undefined;
    let timer: number | undefined;
    const sync = () => {
      if (!renderer.current) return;
      if (visible && !document.hidden) renderer.current.start(motion.matches);
      else renderer.current.stop();
    };
    const load = () => {
      idle = undefined;
      timer = undefined;
      if (disposed || !visible || document.hidden) {
        loading = false;
        return;
      }
      void import("./echo-webgl").then(({ createEchoRenderer }) => {
        if (disposed) return;
        renderer.current = createEchoRenderer(target, stateRef.current,
          () => levelRef.current?.() ?? 0);
        sync();
      }).catch(() => { loading = false; });
    };
    const schedule = () => {
      if (loading || renderer.current || !visible || document.hidden) return;
      loading = true;
      if (window.requestIdleCallback) idle = window.requestIdleCallback(load, { timeout: 1500 });
      else timer = window.setTimeout(load, 500);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null :
      new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) schedule();
        sync();
      }, { threshold: 0.01 });
    if (observer) observer.observe(target);
    else { visible = true; schedule(); }
    const onVisibility = () => { if (!document.hidden) schedule(); sync(); };
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener?.("change", sync);
    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener?.("change", sync);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  useEffect(() => { renderer.current?.setState(state); }, [state]);
  useEffect(() => { renderer.current?.redraw(); }, [size]);

  return (
    <span
      className="ev-echo"
      data-state={state}
      style={{ inlineSize: size, blockSize: size }}
      aria-hidden={hidden}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : stateLabels[state]}>
      <canvas ref={canvas} className="ev-echo-canvas" aria-hidden="true" />
    </span>
  );
}
