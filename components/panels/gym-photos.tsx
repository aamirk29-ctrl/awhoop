'use client';

// Progress photos — grid, in-browser camera, viewer with compare mode.
// Photos persist to `po_coach_photos` (compressed dataURLs) and upload to the
// Supabase `progress-photos` bucket in the background; once uploaded only the
// URL syncs across devices (same behavior as gym.html).

import * as React from 'react';
import { ArrowLeft, Camera, ImageIcon, RefreshCw } from 'lucide-react';
import { getSupabase } from '@/lib/cloud-sync';
import { storeGet, storeSet, useStorageTick } from '@/lib/storage';
import { PHOTO_KEY, WT_KEY } from '@/lib/gym';
import { dateToKey, parseDateKey } from '@/lib/dates';

export type Photo = { id: string; dataUrl?: string; url?: string; dateKey: string; weight: string };

function photosLoad(): Photo[] {
  return storeGet<Photo[]>(PHOTO_KEY) || [];
}
function photosSave(arr: Photo[]): boolean {
  try {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(arr));
    window.dispatchEvent(new Event('storage'));
    return true;
  } catch {
    return false;
  }
}

function photoFmtDate(key: string): string {
  const d = parseDateKey(key);
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${mons[d.getMonth()]} ${d.getDate()}`;
}

function compressPhotoDataUrl(dataUrl: string, maxDim = 1080, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w >= h) {
          h = Math.round(h * (maxDim / w));
          w = maxDim;
        } else {
          w = Math.round(w * (maxDim / h));
          h = maxDim;
        }
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      try {
        resolve(c.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function uploadPhotoToStorage(dataUrl: string): Promise<string | null> {
  const supa = getSupabase();
  if (!supa) return null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
    const { error } = await supa.storage
      .from('progress-photos')
      .upload(filename, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) return null;
    const { data } = supa.storage.from('progress-photos').getPublicUrl(filename);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

function currentWeightLabel(units: string): string {
  const entries = storeGet<{ dateKey: string; weight: number }[]>(WT_KEY) || [];
  const last = entries[entries.length - 1];
  return last ? `${last.weight.toFixed(1)} ${units}` : '—';
}

function parseWeightStr(w: string | undefined): number | null {
  if (!w) return null;
  const m = String(w).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function ProgressPhotos({ units, accent }: { units: string; accent: string }) {
  const tick = useStorageTick();
  const photos = React.useMemo(() => photosLoad(), [tick]);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 text-left transition-colors hover:border-white/[0.14]"
      >
        <span>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-3">
            Progress photos
          </span>
          <span className="text-[14px] font-medium text-ink">
            {photos.length === 0
              ? '0 photos'
              : `${photos.length} photo${photos.length === 1 ? '' : 's'} · latest ${photoFmtDate(photos[0].dateKey)}`}
          </span>
        </span>
        <span className="text-[20px]" style={{ color: accent }} aria-hidden>
          →
        </span>
      </button>
      {open && <PhotosOverlay units={units} accent={accent} photos={photos} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotosOverlay({
  units,
  accent,
  photos,
  onClose,
}: {
  units: string;
  accent: string;
  photos: Photo[];
  onClose: () => void;
}) {
  const camFileRef = React.useRef<HTMLInputElement>(null);
  const libFileRef = React.useRef<HTMLInputElement>(null);
  const [cam, setCam] = React.useState(false);
  const [viewerId, setViewerId] = React.useState<string | null>(null);

  const addFromDataUrl = async (dataUrl: string) => {
    let compressed = dataUrl;
    try {
      compressed = await compressPhotoDataUrl(dataUrl);
    } catch {
      /* keep original */
    }
    const id = `p${Date.now()}_${Math.floor(Math.random() * 999)}`;
    const entry: Photo = {
      id,
      dataUrl: compressed,
      dateKey: dateToKey(new Date()),
      weight: currentWeightLabel(units),
    };
    const next = [entry, ...photosLoad()];
    if (!photosSave(next)) {
      try {
        entry.dataUrl = await compressPhotoDataUrl(dataUrl, 800, 0.6);
      } catch {
        /* keep */
      }
      if (!photosSave([entry, ...photosLoad()])) {
        alert('Phone storage is full — delete some older progress photos before adding a new one.');
        return;
      }
    }
    uploadPhotoToStorage(entry.dataUrl!).then((url) => {
      if (!url) return;
      const arr = photosLoad();
      const e = arr.find((p) => p.id === id);
      if (!e) return;
      e.url = url;
      delete e.dataUrl;
      photosSave(arr);
    });
  };

  const fileToPhoto = (file: File) => {
    const r = new FileReader();
    r.onload = (e) => addFromDataUrl(String(e.target?.result));
    r.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#050506]">
      <div className="mx-auto max-w-[720px] px-5 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <div className="mb-5 flex items-center gap-3.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.04] text-ink"
          >
            <ArrowLeft size={15} aria-hidden />
          </button>
          <h2 className="text-[24px] font-semibold tracking-tight text-ink">Progress</h2>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={async () => {
              if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
                setCam(true);
                return;
              }
              camFileRef.current?.click();
            }}
            className="flex h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-black"
            style={{ background: accent }}
          >
            <Camera size={16} aria-hidden /> Take Photo
          </button>
          <button
            type="button"
            onClick={() => libFileRef.current?.click()}
            className="flex h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] text-[14px] font-semibold text-ink"
          >
            <ImageIcon size={16} aria-hidden /> From Library
          </button>
        </div>
        <input
          ref={camFileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) fileToPhoto(f);
            e.target.value = '';
          }}
        />
        <input
          ref={libFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) fileToPhoto(f);
            e.target.value = '';
          }}
        />

        <div className="grid grid-cols-2 gap-2.5">
          {photos.length === 0 ? (
            <div className="col-span-2 py-14 text-center text-[13px] text-ink-3">
              No photos yet · tap Take Photo to start
            </div>
          ) : (
            photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewerId(p.id)}
                className="relative aspect-[3/4] cursor-pointer overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br from-[#1a1a24] to-[#0a0f0a]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url || p.dataUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between px-3.5 py-3 text-[12px] font-medium">
                  <span style={{ color: accent }}>{photoFmtDate(p.dateKey)}</span>
                  <span className="text-ink">{p.weight || '—'}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {cam && (
        <CameraModal
          onClose={() => setCam(false)}
          onCapture={(dataUrl) => {
            setCam(false);
            addFromDataUrl(dataUrl);
          }}
          onUnavailable={() => {
            setCam(false);
            alert('Camera unavailable. Use "From Library" instead.');
          }}
        />
      )}

      {viewerId && (
        <PhotoViewer
          photos={photos}
          startId={viewerId}
          units={units}
          accent={accent}
          onClose={() => setViewerId(null)}
        />
      )}
    </div>
  );
}

function CameraModal({
  onClose,
  onCapture,
  onUnavailable,
}: {
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
  onUnavailable: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [facing, setFacing] = React.useState<'environment' | 'user'>('environment');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        } catch {
          onUnavailable();
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, onUnavailable]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.85));
  };

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-black">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full bg-black object-cover" />
      </div>
      <div className="flex items-center justify-between bg-black px-7 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
        <button type="button" onClick={onClose} className="min-w-[60px] cursor-pointer p-2.5 text-[14px] font-medium text-ink">
          Cancel
        </button>
        <button
          type="button"
          onClick={shoot}
          aria-label="Capture"
          className="h-16 w-16 cursor-pointer rounded-full border-4 border-white/30 bg-white shadow-[inset_0_0_0_2px_#fff] active:scale-90"
        />
        <button
          type="button"
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          aria-label="Flip camera"
          className="min-w-[60px] cursor-pointer p-2.5 text-ink"
        >
          <RefreshCw size={20} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PhotoViewer({
  photos,
  startId,
  units,
  accent,
  onClose,
}: {
  photos: Photo[];
  startId: string;
  units: string;
  accent: string;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = React.useState(startId);
  const [mode, setMode] = React.useState<'single' | 'compare'>('single');
  const [compareId, setCompareId] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const confirmTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const active = photos.find((p) => p.id === activeId);
  const other = compareId ? photos.find((p) => p.id === compareId) : null;
  if (!active) return null;

  const defaultCompareFor = (id: string): string | null => {
    const idx = photos.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    return photos[idx + 1]?.id || photos[idx - 1]?.id || null;
  };

  const cycleCompare = () => {
    const others = photos.filter((p) => p.id !== activeId);
    if (!others.length) return;
    const curIdx = others.findIndex((p) => p.id === compareId);
    setCompareId(others[(curIdx + 1) % others.length].id);
  };

  const doDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    photosSave(photos.filter((p) => p.id !== activeId));
    onClose();
  };

  let headline = '';
  let headlineCls = 'text-ink-2';
  if (mode === 'compare' && other) {
    headline = `${photoFmtDate(active.dateKey)} → ${photoFmtDate(other.dateKey)}`;
    const wA = parseWeightStr(active.weight);
    const wB = parseWeightStr(other.weight);
    if (wA != null && wB != null) {
      const diff = wA - wB;
      if (Math.abs(diff) < 0.05) headline += ' · no change';
      else {
        headline += ` · ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} ${units}`;
        headlineCls = diff > 0 ? 'text-warn' : 'text-good';
      }
    }
  }

  const btnCls =
    'cursor-pointer rounded-[10px] border border-white/[0.07] bg-transparent px-3 py-3 text-[14px] font-medium';

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 p-4 pt-[max(1.5rem,env(safe-area-inset-top))]">
      {mode === 'single' ? (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url || active.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="py-4 text-center">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accent }}>
              {photoFmtDate(active.dateKey).toUpperCase()}
            </div>
            <div className="text-[20px] font-semibold text-ink">{active.weight || '—'}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              disabled={photos.length < 2}
              onClick={() => {
                const otherId = defaultCompareFor(activeId);
                if (!otherId) return;
                setCompareId(otherId);
                setMode('compare');
              }}
              className={`${btnCls} disabled:opacity-40`}
              style={{ color: accent, borderColor: `${accent}4d` }}
            >
              Compare
            </button>
            <button type="button" onClick={onClose} className={`${btnCls} text-ink`}>
              Close
            </button>
            <button
              type="button"
              onClick={doDelete}
              className={`${btnCls} border-red-400/30 text-bad ${confirmDelete ? 'bg-red-400/10' : ''}`}
            >
              {confirmDelete ? 'Confirm delete?' : 'Delete'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-2 items-stretch gap-2">
            <div className="flex min-h-0 min-w-0 flex-col items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={active.url || active.dataUrl} alt="" className="max-h-[calc(100%-28px)] max-w-full rounded-md object-contain" />
              <div className="mt-1.5 text-center text-[12px] tabular-nums text-ink-3">
                {photoFmtDate(active.dateKey)} · {active.weight || '—'}
              </div>
            </div>
            <button
              type="button"
              onClick={cycleCompare}
              title="Tap to compare to a different photo"
              className="flex min-h-0 min-w-0 cursor-pointer flex-col items-center justify-center"
            >
              {other && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={other.url || other.dataUrl} alt="" className="max-h-[calc(100%-28px)] max-w-full rounded-md object-contain" />
                  <div className="mt-1.5 text-center text-[12px] tabular-nums text-ink-3">
                    {photoFmtDate(other.dateKey)} · {other.weight || '—'}
                  </div>
                </>
              )}
            </button>
          </div>
          <div className={`py-3.5 text-center text-[14px] font-semibold tabular-nums ${headlineCls}`}>{headline}</div>
          <div className="grid grid-cols-3 gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={btnCls}
              style={{ color: accent, borderColor: `${accent}4d` }}
            >
              ← Back
            </button>
            <button type="button" onClick={onClose} className={`${btnCls} text-ink`}>
              Close
            </button>
            <button
              type="button"
              onClick={doDelete}
              className={`${btnCls} border-red-400/30 text-bad ${confirmDelete ? 'bg-red-400/10' : ''}`}
            >
              {confirmDelete ? 'Confirm delete?' : 'Delete'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
