'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Adds `.in` to every `.reveal` element as it scrolls into view. CSS handles the motion
 *  (and disables it under prefers-reduced-motion). Content is never left hidden: elements
 *  already on screen are revealed immediately and a fallback reveals everything if the observer never reports. */
export function RevealObserver() {
  const pathname = usePathname();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal:not(.in)'));
    const show = (el: Element) => el.classList.add('in');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(show);
      return;
    }
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let ioAlive = false;
    const io = new IntersectionObserver(
      (entries) => {
        ioAlive = true;
        for (const e of entries) {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) requestAnimationFrame(() => show(el));
      else io.observe(el);
    }
    // If the observer never reports (throttled/hidden renderer), reveal everything.
    const fallback = window.setTimeout(() => {
      if (ioAlive) return;
      document.querySelectorAll('.reveal:not(.in)').forEach(show);
      io.disconnect();
    }, 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [pathname]);
  return null;
}
