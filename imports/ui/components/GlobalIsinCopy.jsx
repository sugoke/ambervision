import React, { useEffect, useState } from 'react';

/**
 * App-wide "click an ISIN to copy it".
 *
 * ISINs are rendered as plain text in dozens of places (PMS, order book, order
 * modals, schedules, reports...). Rather than wrapping each one, a single
 * delegated listener treats any element whose whole text is a valid ISIN as
 * copyable: copy cursor on hover, clipboard + "ISIN copied" toast on click.
 *
 * Only a real ISIN qualifies (2-letter country, 9 alphanumerics, check digit
 * verified), so account numbers and references are left alone. Inputs, text
 * selections and elements already handled by <CopyableISIN> are skipped. A
 * click on an ISIN that is also a link copies it and still follows the link.
 */

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// ISIN check digit: letters become numbers (A=10 … Z=35), then Luhn mod 10.
export const isValidIsin = (value) => {
  if (!ISIN_SHAPE.test(value)) return false;
  const digits = value.slice(0, 11).split('').map(ch => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');
  let sum = 0;
  let double = true; // rightmost digit of the payload is doubled (check digit excluded)
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10 === Number(value[11]);
};

const MAX_DEPTH = 4; // how far up from the clicked node to look for the ISIN element

// The element (at or above the event target) whose entire text is one ISIN.
const findIsinElement = (target) => {
  let el = target?.nodeType === 1 ? target : target?.parentElement;
  for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    if (el.closest('input, textarea, select, [contenteditable="true"], [data-isin-copy="off"]')) return null;
    const text = (el.textContent || '').trim();
    if (text.length > 12) return null; // grew past a single code: stop climbing
    if (text.length === 12 && isValidIsin(text)) return { el, isin: text };
  }
  return null;
};

export default function GlobalIsinCopy() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let hideTimer = null;

    const onOver = (e) => {
      const hit = findIsinElement(e.target);
      if (hit && !hit.el.dataset.isinCopyReady) {
        hit.el.dataset.isinCopyReady = '1';
        hit.el.style.cursor = 'copy';
        if (!hit.el.title) hit.el.title = 'Click to copy ISIN';
      }
    };

    const onClick = (e) => {
      if (e.button !== 0 || e.defaultPrevented) return;
      // Selecting text with the mouse ends in a click: don't overwrite it
      if (String(window.getSelection?.() || '').trim()) return;
      const hit = findIsinElement(e.target);
      if (!hit) return;
      const show = () => {
        clearTimeout(hideTimer);
        setToast({ isin: hit.isin, x: e.clientX, y: e.clientY });
        hideTimer = setTimeout(() => setToast(null), 1400);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(hit.isin).then(show).catch(() => {});
      }
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('click', onClick);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('click', onClick);
    };
  }, []);

  if (!toast) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: toast.x,
        top: Math.max(8, toast.y - 36),
        transform: 'translateX(-50%)',
        zIndex: 100000,
        background: 'var(--gain-color)',
        color: '#fff',
        fontSize: '0.75rem',
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      }}
    >
      ISIN copied · {toast.isin}
    </div>
  );
}
