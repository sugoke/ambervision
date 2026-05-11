import React, { useState, useEffect, useRef } from 'react';
import { formatNumberForInput, stripNumberFormatting } from '../../utils/formatters.js';

/**
 * Drop-in replacement for <input type="number"> that formats with thousand separators.
 * Parent state stays as raw strings (no commas), so parseFloat() works unchanged.
 *
 * Props:
 *   value        - raw string from parent (e.g. "1000000.50")
 *   onChange      - called with event where e.target.value is the raw (unformatted) string
 *   maxDecimals   - max decimal places allowed (0 for integers, 2 for prices, 6 for FX)
 *   ...rest       - passed through to <input> (style, placeholder, disabled, etc.)
 */
export default function FormattedNumberInput({ value, onChange, maxDecimals = 2, ...rest }) {
  const [displayValue, setDisplayValue] = useState('');
  const inputRef = useRef(null);
  const cursorRef = useRef(null);

  // Sync display when parent value changes externally
  useEffect(() => {
    const raw = value === undefined || value === null ? '' : String(value);
    setDisplayValue(formatNumberForInput(raw, { maxDecimals }));
  }, [value, maxDecimals]);

  // Restore cursor position after React re-render
  useEffect(() => {
    if (cursorRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(cursorRef.current, cursorRef.current);
      cursorRef.current = null;
    }
  });

  const handleChange = (e) => {
    const input = e.target;
    const caretBefore = input.selectionStart;
    const oldFormatted = displayValue;
    let raw = input.value;

    // Strip everything except digits, decimal point, and leading minus
    raw = raw.replace(/[^0-9.\-]/g, '');

    // Only allow one minus at the start
    if (raw.indexOf('-') > 0) raw = raw.replace(/-/g, '');

    // Only allow one decimal point
    const firstDot = raw.indexOf('.');
    if (firstDot !== -1) {
      raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
    }

    // Enforce maxDecimals = 0 means no decimal point at all
    if (maxDecimals === 0) {
      raw = raw.replace(/\./g, '');
    }

    const formatted = formatNumberForInput(raw, { maxDecimals });
    setDisplayValue(formatted);

    // Calculate new cursor position: count commas before cursor in old vs new
    const commasBefore = (oldFormatted.slice(0, caretBefore).match(/,/g) || []).length;
    const commasAfter = (formatted.slice(0, caretBefore + (formatted.length - oldFormatted.length)).match(/,/g) || []).length;
    cursorRef.current = caretBefore + (commasAfter - commasBefore);

    // Call parent onChange with raw value (no commas)
    if (onChange) {
      onChange({ target: { value: raw, name: rest.name || '' } });
    }
  };

  // Remove min, max, step — not relevant for type="text"
  const { min, max, step, type, ...inputProps } = rest;

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      {...inputProps}
    />
  );
}
