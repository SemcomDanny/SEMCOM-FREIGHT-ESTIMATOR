import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/**
 * Every displayed cost can be expanded to show how it was derived and which
 * rate version it came from — the estimator must never have to trust a number
 * they cannot trace.
 */
export function Explain({ formula, source, children }: { formula: string; source?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="cursor-help border-b border-dotted border-slate-400 text-left hover:border-slate-700"
        aria-expanded={open}
      >
        {children}
      </button>
      {open && (
        <span
          className="absolute right-0 z-30 mt-1 block w-72 rounded border border-slate-300 bg-white p-2.5 text-left text-xs font-normal leading-relaxed text-slate-700 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          <span className="block font-semibold text-slate-900">How this is calculated</span>
          <span className="mt-1 block font-mono text-[11px] text-slate-700">{formula}</span>
          {source && (
            <span className="mt-1.5 block border-t border-slate-200 pt-1.5 text-[11px] text-slate-500">
              Rate version {source}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function Banner({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  } as const;
  return (
    <div className={`rounded border px-3 py-2 text-sm ${tones[tone]} ${className}`}>{children}</div>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'accent' | 'warning';
  hint?: string;
}) {
  const tones = {
    default: 'text-slate-900',
    accent: 'text-blue-700',
    warning: 'text-amber-700',
  } as const;
  return (
    <div className="px-3 py-2">
      <div className="label">{label}</div>
      <div className={`tabular text-xl font-semibold ${tones[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {label}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>
        <div className="card-head">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export const fmt = {
  cbm: (v: number, dp = 3) => v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }),
  kg: (v: number, dp = 1) => v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }),
  money: (v: number, currency = 'AUD', dp = 2) =>
    `${currency === 'AUD' ? '$' : `${currency} `}${v.toLocaleString('en-AU', {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    })}`,
  pct: (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`,
  int: (v: number) => v.toLocaleString('en-AU'),
};
