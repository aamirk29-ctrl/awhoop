'use client';

// Reactive localStorage layer. Every panel keeps the exact keys the old
// static pages used, so existing local + Supabase-synced data carries over
// untouched. Writes go through storeSet/storeRemove (or any direct
// localStorage.setItem — cloud-sync patches it) and notify subscribers.

import { useSyncExternalStore } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();

export function emitStorageChange() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      /* subscriber errors must not break the rest */
    }
  }
}

export function subscribeStorage(cb: Listener): () => void {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function storeGet<T = unknown>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function storeSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
  emitStorageChange();
}

export function storeRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
  emitStorageChange();
}

export function storeListKeys(prefix: string): string[] {
  if (typeof window === 'undefined') return [];
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

// ---- hooks -----------------------------------------------------------------

// Parsed-value cache keyed by raw string so useSyncExternalStore snapshots
// stay referentially stable between renders.
const parseCache = new Map<string, { raw: string; parsed: unknown }>();

function getSnapshotFor(key: string): unknown {
  const raw = typeof window === 'undefined' ? null : localStorage.getItem(key);
  if (raw == null) return null;
  const hit = parseCache.get(key);
  if (hit && hit.raw === raw) return hit.parsed;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  parseCache.set(key, { raw, parsed });
  return parsed;
}

/** Live-read a single localStorage key; re-renders on any storage change. */
export function useStorageValue<T>(key: string): T | null {
  return useSyncExternalStore(
    subscribeStorage,
    () => getSnapshotFor(key) as T | null,
    () => null,
  );
}

let tick = 0;
function subscribeTick(cb: Listener) {
  return subscribeStorage(() => {
    tick++;
    cb();
  });
}

/** Version counter that bumps on every storage change — for components that
 *  read many keys imperatively during render. */
export function useStorageTick(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => tick,
    () => 0,
  );
}
