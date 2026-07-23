import { useEffect, useState } from 'react';

// 24-hour time field. Deliberately NOT <input type="time">: that renders
// AM/PM or 24h depending on the browser/OS locale, with no way to force 24h.
// This is a plain text field that always shows and stores "HH:MM".
//
// Typing is forgiving — "9", "930", "9:3", "11.30" all normalise on blur:
//   9    -> 09:00     930  -> 09:30
//   11   -> 11:00     1130 -> 11:30
//   24   -> 00:00, or 24:00 in a "tot" field (see midnightAs24)
// Out-of-range values are clamped (25 -> 23, :75 -> :59). Empty commits null.

// midnightAs24: for "tot" fields, keep midnight as "24:00" instead of "00:00"
// — same instant, but "open 11:00 tot 24:00" reads right and matches what the
// customer is shown. Both forms are understood everywhere (see inDailyWindow).
export function normalizeTime(raw: string, midnightAs24 = false): string | null {
  const s = String(raw || '').trim();
  if (!s.replace(/\D/g, '')) return null;
  let h: number, m: number;
  if (s.includes(':')) {
    // Explicit separator: trust it, so "1:5" is 01:05 (not 15:00).
    const [hs, ms] = s.split(':');
    h = Number(hs.replace(/\D/g, '') || 0);
    m = Number(ms?.replace(/\D/g, '') || 0);
  } else {
    const digits = s.replace(/\D/g, '');
    if (digits.length <= 2) { h = Number(digits); m = 0; }
    else if (digits.length === 3) { h = Number(digits.slice(0, 1)); m = Number(digits.slice(1)); }
    else { h = Number(digits.slice(0, 2)); m = Number(digits.slice(2, 4)); }
  }
  if (h === 24 && m === 0) return midnightAs24 ? '24:00' : '00:00';
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  const out = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  // In a "tot" field midnight is the end of the day, not the start of it.
  return midnightAs24 && out === '00:00' ? '24:00' : out;
}

export default function TimeInput({
  value, onCommit, placeholder = '11:00', width = 78, commitOnChange = false, midnightAs24 = false, title,
}: {
  value?: string | null;
  onCommit: (v: string | null) => void;
  placeholder?: string;
  width?: number;
  /** Commit as soon as the text parses (for modals where blur may not fire
   *  before a disabled button becomes enabled). Otherwise commit on blur. */
  commitOnChange?: boolean;
  /** "tot" field: show/store midnight as 24:00 rather than 00:00. */
  midnightAs24?: boolean;
  title?: string;
}) {
  const [text, setText] = useState(value || '');
  // Re-seed when the stored value changes underneath us (reload, socket push).
  useEffect(() => { setText(value || ''); }, [value]);

  const commit = () => {
    const norm = normalizeTime(text, midnightAs24);
    setText(norm || '');
    if ((norm || null) !== (value || null)) onCommit(norm);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      title={title}
      value={text}
      maxLength={5}
      style={{ width, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      onChange={(e) => {
        // digits and one colon only
        const next = e.target.value.replace(/[^\d:]/g, '').slice(0, 5);
        setText(next);
        if (commitOnChange) {
          const digits = next.replace(/\D/g, '');
          onCommit(digits.length >= 3 ? normalizeTime(next, midnightAs24) : null);
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
