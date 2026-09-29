import { useEffect, useRef, useState } from 'react';

/**
 * Numeric cell that keeps what the user typed while they are typing.
 *
 * Parsing on every keystroke would fight the user — "0." and "1.5e" would be
 * rewritten under the cursor — so the raw text is held locally while focused
 * and only pushed up once it parses.
 */
export function NumInput({
  value,
  onChange,
  dp = 2,
  className = 'num',
  placeholder,
  min,
  disabled,
  onKeyDown,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  dp?: number;
  className?: string;
  placeholder?: string;
  min?: number;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  title?: string;
}) {
  const [text, setText] = useState(() => format(value, dp));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value, dp));
  }, [value, dp]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(format(value, dp));
      }}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === '') {
          onChange(0);
          return;
        }
        const n = Number(raw.replace(/,/g, ''));
        if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n);
      }}
    />
  );
}

function format(value: number, dp: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  const rounded = Math.round(value * 10 ** dp) / 10 ** dp;
  return String(rounded);
}
