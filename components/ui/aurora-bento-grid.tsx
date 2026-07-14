'use client';

// Aurora bento grid — adapted from the 21st.dev aurora-bento-grid pattern
// (AuroraBackground / BentoGrid / BentoGridItem) for this dashboard:
// each item carries its own accent gradient, a live metric, and an
// `expanded` state driven by shared-layout (layoutId) transitions into
// BentoExpandedOverlay.

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BentoAccent = {
  /** gradient start (hex) */ from: string;
  /** gradient end (hex) */ to: string;
  /** readable accent for text/icons on the dark base */ text: string;
};

export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 -z-10 overflow-hidden', className)} aria-hidden="true">
      <div
        className="aurora-blob aurora-blob-a"
        style={{
          top: '-12%',
          right: '-8%',
          width: '55vw',
          height: '55vw',
          background:
            'radial-gradient(circle at 40% 40%, rgba(167,139,250,0.13), rgba(224,118,88,0.10) 55%, transparent 75%)',
        }}
      />
      <div
        className="aurora-blob aurora-blob-b"
        style={{
          bottom: '-18%',
          left: '-10%',
          width: '60vw',
          height: '60vw',
          background:
            'radial-gradient(circle at 60% 40%, rgba(34,211,238,0.08), rgba(52,211,153,0.06) 50%, transparent 75%)',
        }}
      />
      <div
        className="aurora-blob aurora-blob-a"
        style={{
          top: '30%',
          left: '38%',
          width: '38vw',
          height: '38vw',
          background:
            'radial-gradient(circle at 50% 50%, rgba(251,113,133,0.05), transparent 70%)',
          animationDelay: '-14s',
        }}
      />
    </div>
  );
}

export function BentoGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-3.5 md:grid-cols-6 md:auto-rows-[11.5rem]', className)}>
      {children}
    </div>
  );
}

const cardEase = [0.22, 1, 0.36, 1] as const;

export function BentoGridItem({
  id,
  index,
  title,
  icon: Icon,
  accent,
  metric,
  metricSuffix,
  sub,
  viz,
  body,
  expanded,
  onOpen,
  className,
}: {
  id: string;
  index: number;
  title: string;
  icon: LucideIcon;
  accent: BentoAccent;
  metric: string;
  metricSuffix?: string;
  sub?: React.ReactNode;
  viz?: React.ReactNode;
  /** optional content filling the card's middle (tall hero cards) */
  body?: React.ReactNode;
  expanded: boolean;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <div className={cn('min-h-[10.5rem] md:min-h-0', className)}>
      {!expanded && (
        <motion.button
          type="button"
          layoutId={`bento-${id}`}
          onClick={onOpen}
          initial={{ opacity: 0, scale: 0.94, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 + index * 0.06, ease: cardEase }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.985 }}
          className="bento-shine group relative flex h-full w-full cursor-pointer flex-col text-left"
          style={{
            borderRadius: 24,
            background: `linear-gradient(140deg, ${accent.from}1f 0%, rgba(255,255,255,0.035) 42%, ${accent.to}14 100%)`,
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.45)',
          }}
          aria-label={`Open ${title}`}
        >
          {/* accent hairline along the top */}
          <span
            aria-hidden
            className="absolute inset-x-5 top-0 h-px opacity-70"
            style={{
              background: `linear-gradient(90deg, transparent, ${accent.from}99, ${accent.to}66, transparent)`,
            }}
          />
          <div className="flex flex-1 flex-col p-5">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-[10px]"
                style={{
                  background: `linear-gradient(140deg, ${accent.from}33, ${accent.to}24)`,
                  color: accent.text,
                  boxShadow: `0 0 14px ${accent.from}26`,
                }}
              >
                <Icon size={16} strokeWidth={2.2} aria-hidden />
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">
                {title}
              </span>
              <span
                aria-hidden
                className="ml-auto text-ink-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ink-3"
              >
                →
              </span>
            </div>

            {body && <div className="min-h-0 flex-1 overflow-hidden pt-4">{body}</div>}

            <div className="mt-auto flex items-end justify-between gap-3 pt-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[30px] font-bold leading-none tracking-tight text-ink tabular-nums">
                    {metric}
                  </span>
                  {metricSuffix && (
                    <span className="font-mono text-[12px] font-semibold text-ink-3">
                      {metricSuffix}
                    </span>
                  )}
                </div>
                {sub && <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{sub}</div>}
              </div>
              {viz && <div className="shrink-0">{viz}</div>}
            </div>
          </div>
        </motion.button>
      )}
    </div>
  );
}

export function BentoExpandedOverlay({
  id,
  title,
  icon: Icon,
  accent,
  onClose,
  maxWidth = 760,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  accent: BentoAccent;
  onClose: () => void;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    document.body.classList.add('panel-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('panel-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-[6px]"
        aria-hidden
      />
      <motion.div
        layoutId={`bento-${id}`}
        transition={{ duration: 0.45, ease: cardEase }}
        className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden sm:max-h-[92dvh]"
        style={{
          maxWidth,
          borderRadius: 24,
          background:
            'linear-gradient(180deg, rgba(20,20,23,0.97) 0%, rgba(11,11,13,0.98) 100%)',
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.07), 0 30px 90px rgba(0,0,0,0.7), 0 0 60px ${accent.from}14`,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <span
          aria-hidden
          className="absolute inset-x-6 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent.from}aa, ${accent.to}77, transparent)`,
          }}
        />
        <header className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-[max(1.1rem,env(safe-area-inset-top))] sm:px-6">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(140deg, ${accent.from}33, ${accent.to}24)`,
              color: accent.text,
              boxShadow: `0 0 16px ${accent.from}2b`,
            }}
          >
            <Icon size={17} strokeWidth={2.2} aria-hidden />
          </span>
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink-2">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-ink-2 transition-colors hover:bg-white/10 hover:text-ink"
            aria-label={`Close ${title}`}
          >
            <X size={15} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-1 sm:px-6">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export { AnimatePresence };
