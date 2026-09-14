"use client";

import { useSyncExternalStore } from "react";

// =============================================================================
// Clock
// =============================================================================
//
// One shared ticker for the whole page rather than an interval per
// countdown. Exposed through useSyncExternalStore so the server snapshot is
// a fixed zero: the server and the first client render cannot agree on a
// clock, so anything derived from this treats zero as "not yet".

let nowSec = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const next = Math.floor(Date.now() / 1000);
  if (next === nowSec) return;
  nowSec = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    tick();
    timer = setInterval(tick, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => nowSec;
const getServerSnapshot = () => 0;

/** The current unix time in seconds, ticking. Zero until mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const noopSubscribe = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

/** True once rendering on the client, false during server render and hydration. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, clientTrue, serverFalse);
}
