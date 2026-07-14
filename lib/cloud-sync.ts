'use client';

// Multi-channel port of the old sync.js + gym.html's po-coach sync.
// Each channel mirrors one row of the Supabase `app_state` table (same keys
// the static pages used: goals / health / finance / po-coach), pushes local
// changes debounced, and applies realtime remote changes. Because the SPA
// hosts every panel on one page, all four channels run together.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emitStorageChange } from './storage';

const SUPABASE_URL = 'https://sxpertnlrqctzrbybafs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EZd_oPrdZSvu5sAaAulsAA_kFARX0w0';

type Channel = {
  appKey: string;
  syncedKeys: string[];
  syncedPrefixes: string[];
  /** Optional per-key transform applied when collecting local → remote. */
  collect?: (key: string, value: unknown) => unknown;
  /** Optional per-key merge applied when applying remote → local. Returns the
   *  value to store (JSON-stringified by the caller). */
  applyMerge?: (key: string, remoteValue: unknown, localRaw: string | null) => unknown;
  pushTimer?: ReturnType<typeof setTimeout>;
  lastSyncedJson?: string | null;
  pendingRemote?: Record<string, unknown> | null;
};

// The gym page synced photos without their base64 payloads (only uploaded
// URLs travel), and merged not-yet-uploaded local photos back in on apply.
type SyncedPhoto = { id: string; url?: string; dataUrl?: string; dateKey: string; weight: string };

const CHANNELS: Channel[] = [
  {
    appKey: 'goals',
    syncedKeys: [],
    syncedPrefixes: ['goals:'],
  },
  {
    appKey: 'health',
    syncedKeys: [
      'stack:items',
      'stack:version',
      'stack:low',
      'po_water_v1',
      'nutrition_v1',
      'whoop_burn_v1',
      'food_log_v1',
      'meal_presets_v1',
    ],
    syncedPrefixes: ['stack:taken:'],
  },
  {
    appKey: 'finance',
    syncedKeys: ['subs', 'wishlist', 'incoming_orders', 'nw_currency', 'nw:activity', 'nw:history'],
    syncedPrefixes: ['nw:'],
  },
  {
    appKey: 'po-coach',
    syncedKeys: ['po_coach_v1', 'po_coach_workout_done', 'po_coach_weights', 'po_coach_photos'],
    syncedPrefixes: [],
    collect: (key, value) => {
      if (key === 'po_coach_photos' && Array.isArray(value)) {
        return (value as SyncedPhoto[])
          .filter((p) => p && p.url)
          .map((p) => ({ id: p.id, url: p.url, dateKey: p.dateKey, weight: p.weight }));
      }
      return value;
    },
    applyMerge: (key, remoteValue, localRaw) => {
      if (key !== 'po_coach_photos') return remoteValue;
      let localPhotos: SyncedPhoto[] = [];
      try {
        localPhotos = localRaw ? JSON.parse(localRaw) : [];
      } catch {
        localPhotos = [];
      }
      const remotePhotos = Array.isArray(remoteValue) ? (remoteValue as SyncedPhoto[]) : [];
      const remoteIds = new Set(remotePhotos.map((p) => p && p.id));
      const localOnly = localPhotos.filter((p) => p && !p.url && !remoteIds.has(p.id));
      return [...remotePhotos, ...localOnly];
    },
  },
];

let supa: SupabaseClient | null = null;
let started = false;
let suppressSync = false;

const origSet = typeof window !== 'undefined' ? localStorage.setItem.bind(localStorage) : null;
const origRemove = typeof window !== 'undefined' ? localStorage.removeItem.bind(localStorage) : null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (!supa) supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  return supa;
}

function matches(ch: Channel, k: string): boolean {
  if (ch.syncedKeys.includes(k)) return true;
  return ch.syncedPrefixes.some((p) => k.startsWith(p));
}

function listChannelKeys(ch: Channel): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && matches(ch, k)) out.push(k);
  }
  return out;
}

function collect(ch: Channel): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of listChannelKeys(ch)) {
    const raw = localStorage.getItem(k);
    if (raw == null) continue;
    let val: unknown;
    try {
      val = JSON.parse(raw);
    } catch {
      val = raw;
    }
    out[k] = ch.collect ? ch.collect(k, val) : val;
  }
  return out;
}

function isUserEditing(): boolean {
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return ae.getAttribute?.('contenteditable') === 'true';
}

function applyRemote(ch: Channel, remote: Record<string, unknown>): boolean {
  if (!remote || typeof remote !== 'object') return false;
  suppressSync = true;
  let changed = false;
  try {
    for (const k of Object.keys(remote)) {
      if (!matches(ch, k)) continue;
      const localRaw = localStorage.getItem(k);
      const value = ch.applyMerge ? ch.applyMerge(k, remote[k], localRaw) : remote[k];
      const incoming = JSON.stringify(value);
      if (localRaw !== incoming) {
        try {
          origSet!(k, incoming);
          changed = true;
        } catch {
          /* quota */
        }
      }
    }
    for (const k of listChannelKeys(ch)) {
      if (!(k in remote)) {
        try {
          origRemove!(k);
          changed = true;
        } catch {
          /* noop */
        }
      }
    }
  } finally {
    suppressSync = false;
  }
  if (changed) emitStorageChange();
  return changed;
}

function maybeApplyRemote(ch: Channel, remote: Record<string, unknown>) {
  if (isUserEditing()) {
    ch.pendingRemote = remote;
    return;
  }
  applyRemote(ch, remote);
}

async function pushNow(ch: Channel) {
  const client = getSupabase();
  if (!client) return;
  const state = collect(ch);
  const json = JSON.stringify(state);
  if (json === ch.lastSyncedJson) return;
  try {
    const { error } = await client.from('app_state').upsert(
      { key: ch.appKey, data: state, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (!error) ch.lastSyncedJson = json;
  } catch {
    /* offline — next write retries */
  }
}

function schedulePush(ch: Channel) {
  if (suppressSync) return;
  clearTimeout(ch.pushTimer);
  ch.pushTimer = setTimeout(() => pushNow(ch), 250);
}

function flushOnUnload(ch: Channel) {
  const state = collect(ch);
  const json = JSON.stringify(state);
  if (json === ch.lastSyncedJson) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/app_state?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: ch.appKey, data: state, updated_at: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
    ch.lastSyncedJson = json;
  } catch {
    /* noop */
  }
}

export function initCloudSync() {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Route every localStorage write through the sync scheduler. The original
  // write always happens; sync errors are swallowed.
  localStorage.setItem = function (k: string, v: string) {
    origSet!(k, v);
    try {
      if (!suppressSync) {
        for (const ch of CHANNELS) if (matches(ch, k)) schedulePush(ch);
      }
    } catch {
      /* noop */
    }
  };
  localStorage.removeItem = function (k: string) {
    origRemove!(k);
    try {
      if (!suppressSync) {
        for (const ch of CHANNELS) if (matches(ch, k)) schedulePush(ch);
      }
    } catch {
      /* noop */
    }
  };

  const client = getSupabase();
  if (!client) return;

  for (const ch of CHANNELS) {
    (async () => {
      try {
        const { data, error } = await client
          .from('app_state')
          .select('data')
          .eq('key', ch.appKey)
          .maybeSingle();
        if (!error && data?.data && Object.keys(data.data).length > 0) {
          ch.lastSyncedJson = JSON.stringify(data.data);
          maybeApplyRemote(ch, data.data);
        } else if (Object.keys(collect(ch)).length > 0) {
          schedulePush(ch);
        }
      } catch {
        /* offline start is fine */
      }
      client
        .channel(`app_state_${ch.appKey}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_state', filter: `key=eq.${ch.appKey}` },
          (payload: { new?: { data?: Record<string, unknown> } }) => {
            if (!payload.new?.data) return;
            const incoming = JSON.stringify(payload.new.data);
            if (incoming === ch.lastSyncedJson) return; // echo of our own push
            ch.lastSyncedJson = incoming;
            maybeApplyRemote(ch, payload.new.data);
          },
        )
        .subscribe();
    })();
  }

  const flushAll = () => CHANNELS.forEach(flushOnUnload);
  window.addEventListener('beforeunload', flushAll);
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAll();
  });
  document.addEventListener(
    'focusout',
    () => {
      setTimeout(() => {
        for (const ch of CHANNELS) {
          if (ch.pendingRemote && !isUserEditing()) {
            const r = ch.pendingRemote;
            ch.pendingRemote = null;
            applyRemote(ch, r);
          }
        }
      }, 0);
    },
    true,
  );
}
