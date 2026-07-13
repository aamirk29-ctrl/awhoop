'use client';

// Shared primitives for expanded panels — one visual language (dark glass
// cards, mono eyebrows, white primary buttons) across all five panels.

import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white/[0.035] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_34px_rgba(0,0,0,0.4)]',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center gap-3', className)}>
      <span className="h-px w-[18px] bg-ink-3 opacity-60" aria-hidden />
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink-3">
        {children}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" aria-hidden />
      {right}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export const inputCls =
  'rounded-xl border border-white/[0.09] bg-black/30 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-white/30 focus:bg-black/40';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(inputCls, className)} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return <select {...rest} className={cn(inputCls, 'cursor-pointer', className)} />;
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'cursor-pointer rounded-xl bg-gradient-to-b from-white to-[#e8e5dd] px-4 py-2.5 text-[13px] font-bold text-[#0a0a0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_4px_14px_rgba(0,0,0,0.35)] transition-all hover:-translate-y-px hover:brightness-105 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0',
        className,
      )}
    />
  );
}

export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    />
  );
}

export function DangerGhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <GhostButton
      {...rest}
      className={cn('border-bad/30 text-bad hover:bg-bad/10', className)}
    />
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.04] p-[3px]',
        className,
      )}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-w-0 flex-1 cursor-pointer truncate rounded-lg px-2.5 py-2 text-[12.5px] font-semibold transition-colors',
            o.value === value
              ? 'bg-gradient-to-b from-white to-[#e8e5dd] text-[#0a0a0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]'
              : 'text-ink-3 hover:bg-white/[0.05] hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-4 text-center text-[12px] italic text-ink-3">{children}</div>
  );
}

/** Nested modal used inside an expanded panel (settings, editors). */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.12] bg-[#141416] p-5"
        style={{ maxWidth }}
      >
        <h3 className="mb-4 text-[16px] font-bold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function escapeText(s: unknown): string {
  return String(s == null ? '' : s);
}

export function confirmDialog(msg: string): boolean {
  return typeof window !== 'undefined' && window.confirm(msg);
}
