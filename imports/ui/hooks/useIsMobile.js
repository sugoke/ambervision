import { useState, useEffect } from 'react';

/**
 * Viewport width breakpoint below which we switch to touch/phone layouts.
 * Width (not the smallest dimension) is what decides whether a table or a
 * multi-column form can fit, so a phone held in landscape stays on the mobile
 * layout only while it is genuinely narrow.
 */
export const MOBILE_BREAKPOINT = 768;

/**
 * Track whether the viewport is phone-sized.
 *
 * Components that switch layout wholesale (table → card list, multi-column form →
 * single column) need this in JS rather than CSS, because the app styles inline.
 *
 * @param {number} breakpoint - Max width, in px, considered mobile
 * @returns {boolean} true when the viewport is at or below the breakpoint
 */
export const useIsMobile = (breakpoint = MOBILE_BREAKPOINT) => {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();

    window.addEventListener('resize', check);
    // iOS Safari fires orientationchange before it settles the new innerWidth,
    // so resize alone can miss a rotation; listening to both is harmless.
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [breakpoint]);

  return isMobile;
};

export default useIsMobile;
