/**
 * Shared, counted page-scroll lock for overlays (mobile menu, wallet picker). Each overlay calls lockScroll() when it
 * opens and unlockScroll() when it closes. The page stays locked while any overlay is open, whatever order they close
 * in. Earlier, each overlay saved and restored body.style.overflow itself, and closing them out of order left the page
 * stuck unscrollable.
 */
let count = 0;
let saved = '';

export function lockScroll() {
  if (typeof document === 'undefined') return;
  if (count++ === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

export function unlockScroll() {
  if (typeof document === 'undefined' || count === 0) return;
  if (--count === 0) document.body.style.overflow = saved;
}
